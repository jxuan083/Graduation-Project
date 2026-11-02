"""Run the complete offline suite; missing dependencies must fail CI, never silently skip."""
import os
import pathlib
import sys
import unittest

os.environ['DOCSTORE'] = 'memory'
os.environ['AWS_EC2_METADATA_DISABLED'] = 'true'
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
root = pathlib.Path(__file__).resolve().parents[1]
suite = unittest.defaultTestLoader.discover(str(root / 'backend/tests'))
result = unittest.TextTestRunner(verbosity=2).run(suite)
if result.skipped:
    print('Skipped backend tests are not accepted by the CI gate.', file=sys.stderr)
sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
