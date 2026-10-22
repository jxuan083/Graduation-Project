"""Verify rollback and conflicting money writes on memory and DynamoDB API emulation."""
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import docstore


class AtomicTransactions(unittest.TestCase):
    def setUp(self):
        self.db = docstore.Client(docstore._MemoryBackend())
        self.group = self.db.collection('groups').document('shared')
        self.group.set({'coins':60,'inventory':[]})
        self.receipt = self.group.collection('receipts').document('one')

    def stage_purchase(self, tx):
        before = self.group.get(transaction=tx).to_dict()
        tx.update(self.group,{'coins':before['coins']-60,'inventory':['toy']})
        tx.create(self.receipt,{'item':'toy'})

    def test_failed_operation_commits_nothing(self):
        @docstore.transactional
        def fail(tx):
            self.stage_purchase(tx)
            raise RuntimeError('failed before commit')
        with self.assertRaises(RuntimeError):
            fail(self.db.transaction())
        self.assertEqual(self.group.get().to_dict()['coins'],60)
        self.assertFalse(self.receipt.get().exists)

    def test_competing_updates_abort_whole_transaction(self):
        tx = self.db.transaction()
        self.stage_purchase(tx)
        self.group.update({'coins':30})
        with self.assertRaises(docstore.TransactionConflict):
            tx.commit()
        self.assertEqual(self.group.get().to_dict(),{'coins':30,'inventory':[]})
        self.assertFalse(self.receipt.get().exists)

    def test_retry_reads_latest_balance_instead_of_overspending(self):
        calls = []
        @docstore.transactional
        def purchase(tx):
            before = self.group.get(transaction=tx).to_dict()
            calls.append(before['coins'])
            if before['coins'] < 60:
                raise ValueError('insufficient coins')
            self.stage_purchase(tx)
            if len(calls) == 1:
                self.group.update({'coins':30})
        with self.assertRaises(ValueError):
            purchase(self.db.transaction())
        self.assertEqual(calls,[60,30])
        self.assertEqual(self.group.get().to_dict()['coins'],30)
        self.assertFalse(self.receipt.get().exists)

    def test_success_commits_inventory_balance_and_receipt_together(self):
        docstore.transactional(self.stage_purchase)(self.db.transaction())
        self.assertEqual(self.group.get().to_dict(),{'coins':0,'inventory':['toy']})
        self.assertTrue(self.receipt.get().exists)


class DynamoAtomicTransactions(AtomicTransactions):
    def setUp(self):
        from moto import mock_aws
        import boto3
        self.aws = mock_aws()
        self.aws.start()
        self.addCleanup(self.aws.stop)
        self.env = patch.dict(os.environ,{'AWS_REGION':'us-east-1'})
        self.env.start()
        self.addCleanup(self.env.stop)
        boto3.client('dynamodb',region_name='us-east-1').create_table(
            TableName='pet-test',KeySchema=[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],
            AttributeDefinitions=[{'AttributeName':'pk','AttributeType':'S'},{'AttributeName':'sk','AttributeType':'S'}],
            BillingMode='PAY_PER_REQUEST')
        self.db = docstore.Client(docstore._DynamoBackend('pet-test'))
        self.group = self.db.collection('groups').document('shared')
        self.group.set({'coins':60,'inventory':[]})
        self.receipt = self.group.collection('receipts').document('one')

