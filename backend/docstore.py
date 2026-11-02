"""Firestore 相容層：讓 main.py 原本的 firestore 寫法直接跑在 DynamoDB 上。

用法：`import docstore as firestore; db = firestore.client()`。
只實作專案實際用到的 API（document / collection / collection_group / where /
order_by / limit / stream / set(merge) / update(含 "a.b" 路徑) / batch /
transaction / sentinels）。

儲存格式（DynamoDB 表 DYNAMODB_TABLE）：
  pk   = 父 collection 路徑，例如 "users" 或 "users/abc/friends"
  sk   = 文件 id
  coll = 最後一段 collection 名稱（GSI by_collection，給 collection_group 用）
  data = 文件內容 JSON 字串（datetime 存成 {"__dt__": iso}）
查詢（where / order_by）是把整個 collection 讀回來在記憶體過濾。
# ponytail: collection 全讀再過濾，單一 collection 上萬筆才需要改成 GSI 查詢
"""
import copy
import datetime
import json
import os
import random
import string
import threading
import functools
import time
import uuid

DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "phubbing")


# ===== Sentinels =====
class _Sentinel:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return self.name


SERVER_TIMESTAMP = _Sentinel("SERVER_TIMESTAMP")
DELETE_FIELD = _Sentinel("DELETE_FIELD")


class ArrayUnion:
    def __init__(self, values):
        self.values = list(values)


class ArrayRemove:
    def __init__(self, values):
        self.values = list(values)


class Increment:
    def __init__(self, value):
        self.value = value


class Query:
    ASCENDING = "ASCENDING"
    DESCENDING = "DESCENDING"


class NotFound(Exception):
    pass


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _resolve(value, existing):
    """把 sentinel 套用到現有值上，回傳新值；DELETE_FIELD 回傳 DELETE_FIELD 讓呼叫端刪 key。"""
    if value is SERVER_TIMESTAMP:
        return _now()
    if value is DELETE_FIELD:
        return DELETE_FIELD
    if isinstance(value, ArrayUnion):
        out = list(existing) if isinstance(existing, list) else []
        out.extend(v for v in value.values if v not in out)
        return out
    if isinstance(value, ArrayRemove):
        base = existing if isinstance(existing, list) else []
        return [v for v in base if v not in value.values]
    if isinstance(value, Increment):
        base = existing if isinstance(existing, (int, float)) and not isinstance(existing, bool) else 0
        return base + value.value
    if isinstance(value, dict):
        return _merge({}, value)
    if isinstance(value, list):
        return [_resolve(v, None) for v in value]
    return value


def _merge(target, data):
    """set(merge=True) 語意：巢狀 dict 深度合併。target 會被就地修改並回傳。"""
    for key, value in data.items():
        cur = target.get(key)
        if isinstance(value, dict) and isinstance(cur, dict):
            _merge(cur, value)
            continue
        new = _resolve(value, cur)
        if new is DELETE_FIELD:
            target.pop(key, None)
        else:
            target[key] = new
    return target


def _apply_update(target, data):
    """update() 語意：key 中的 "." 代表巢狀路徑，值整個取代（不深度合併）。"""
    for path, value in data.items():
        parts = path.split(".")
        node = target
        for part in parts[:-1]:
            if not isinstance(node.get(part), dict):
                node[part] = {}
            node = node[part]
        new = _resolve(value, node.get(parts[-1]))
        if new is DELETE_FIELD:
            node.pop(parts[-1], None)
        else:
            node[parts[-1]] = new
    return target


def _get_path(data, path):
    node = data
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return _MISSING
        node = node[part]
    return node


_MISSING = object()


# ===== JSON 編解碼 =====
def _json_default(o):
    if isinstance(o, datetime.datetime):
        if o.tzinfo is None:
            o = o.replace(tzinfo=datetime.timezone.utc)
        return {"__dt__": o.isoformat()}
    if isinstance(o, (set, tuple)):
        return list(o)
    if hasattr(o, "item"):  # numpy 數字
        return o.item()
    raise TypeError(f"無法存入資料庫的型別：{type(o).__name__}")


def _json_hook(d):
    if len(d) == 1 and "__dt__" in d:
        return datetime.datetime.fromisoformat(d["__dt__"])
    return d


def _dumps(data):
    return json.dumps(data, default=_json_default, ensure_ascii=False)


def _loads(raw):
    return json.loads(raw, object_hook=_json_hook)


# ===== 底層儲存 =====
class _DynamoBackend:
    def __init__(self, table_name):
        import boto3
        from boto3.dynamodb.conditions import Key
        self._key = Key
        region = os.environ.get("AWS_REGION", "ap-northeast-1")  # boto3 只認 AWS_DEFAULT_REGION，要明確指定
        self._table = boto3.resource("dynamodb", region_name=region).Table(table_name)
        self._tx_client = boto3.client("dynamodb", region_name=region)

    def get(self, pk, sk):
        return self.snapshot(pk, sk)[0]

    def snapshot(self, pk, sk):
        item = self._table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True).get("Item")
        raw = item['data'] if item else None
        return (_loads(raw) if raw is not None else None), raw

    def atomic_commit(self, reads, writes):
        operations = []
        for (pk, sk), raw in reads.items():
            condition = {'TableName': self._table.name,
                         'ConditionExpression': 'attribute_not_exists(pk)' if raw is None else '#data = :before'}
            if raw is not None:
                condition.update(ExpressionAttributeNames={'#data':'data'}, ExpressionAttributeValues={':before':{'S':raw}})
            key = {'pk':{'S':pk}, 'sk':{'S':sk}}
            if (pk,sk) in writes:
                data = writes[(pk,sk)]
                if data is None:
                    operations.append({'Delete': {**condition, 'Key':key}})
                else:
                    item = {**key,'coll':{'S':pk.rsplit('/',1)[-1]},'data':{'S':_dumps(data)}}
                    operations.append({'Put': {**condition,'Item':item}})
            else:
                operations.append({'ConditionCheck':{**condition,'Key':key}})
        if not writes:
            return
        if len(operations) > 100:
            raise ValueError('DynamoDB transaction exceeds 100 documents')
        try:
            self._tx_client.transact_write_items(TransactItems=operations, ClientRequestToken=str(uuid.uuid4()))
        except self._tx_client.exceptions.TransactionCanceledException as error:
            reasons = error.response.get('CancellationReasons', [])
            if reasons and any(reason.get('Code') in ('ConditionalCheckFailed','TransactionConflict') for reason in reasons):
                raise TransactionConflict() from error
            raise

    def put(self, pk, sk, data):
        coll = pk.rsplit("/", 1)[-1]
        self._table.put_item(Item={"pk": pk, "sk": sk, "coll": coll, "data": _dumps(data)})

    def delete(self, pk, sk):
        self._table.delete_item(Key={"pk": pk, "sk": sk})

    def _query(self, **kwargs):
        while True:
            resp = self._table.query(**kwargs)
            for item in resp.get("Items", []):
                yield item["pk"], item["sk"], _loads(item["data"])
            if "LastEvaluatedKey" not in resp:
                return
            kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def list_collection(self, pk):
        return self._query(KeyConditionExpression=self._key("pk").eq(pk))

    def list_group(self, coll):
        return self._query(IndexName="by_collection", KeyConditionExpression=self._key("coll").eq(coll))


class _MemoryBackend:
    """本機測試用，資料只存在記憶體。"""

    def __init__(self):
        self._items = {}

    def get(self, pk, sk):
        return self.snapshot(pk, sk)[0]

    def snapshot(self, pk, sk):
        raw = self._items.get((pk, sk))
        return (_loads(raw) if raw is not None else None), raw

    def atomic_commit(self, reads, writes):
        with _TX_LOCK:
            if any(self._items.get(key) != before for key,before in reads.items()):
                raise TransactionConflict()
            # Encode everything before replacing the backing map: failures never partially commit.
            next_items = dict(self._items)
            for key,data in writes.items():
                if data is None:
                    next_items.pop(key,None)
                else:
                    next_items[key] = _dumps(data)
            self._items = next_items

    def put(self, pk, sk, data):
        self._items[(pk, sk)] = _dumps(data)

    def delete(self, pk, sk):
        self._items.pop((pk, sk), None)

    def list_collection(self, pk):
        return [(p, s, _loads(r)) for (p, s), r in sorted(self._items.items()) if p == pk]

    def list_group(self, coll):
        return [(p, s, _loads(r)) for (p, s), r in sorted(self._items.items()) if p.rsplit("/", 1)[-1] == coll]


# ===== Firestore 風格 API =====
def _auto_id():
    return "".join(random.choices(string.ascii_letters + string.digits, k=20))


class DocumentSnapshot:
    def __init__(self, reference, data):
        self.reference = reference
        self.id = reference.id
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return copy.deepcopy(self._data)

    def get(self, field):
        value = _get_path(self._data or {}, field)
        return None if value is _MISSING else value


class DocumentReference:
    def __init__(self, client, parent_path, doc_id):
        self._client = client
        self._pk = parent_path
        self.id = doc_id

    @property
    def path(self):
        return f"{self._pk}/{self.id}"

    @property
    def parent(self):
        return CollectionReference(self._client, self._pk)

    def collection(self, name):
        return CollectionReference(self._client, f"{self.path}/{name}")

    def get(self, transaction=None, **_):
        if transaction is not None:
            return transaction.get(self)
        return DocumentSnapshot(self, self._client._backend.get(self._pk, self.id))

    def set(self, data, merge=False):
        backend = self._client._backend
        if merge:
            transactional(lambda tx: tx.set(self,data,merge=True))(self._client.transaction())
        else:
            backend.put(self._pk,self.id,_merge({},data))

    def update(self, data):
        # Use the same conditional path as multi-document transactions, so a
        # concurrent ordinary group update cannot overwrite a committed wallet.
        transactional(lambda tx: tx.update(self,data))(self._client.transaction())

    def create(self, data):
        transactional(lambda tx: tx.create(self,data))(self._client.transaction())

    def delete(self):
        self._client._backend.delete(self._pk, self.id)


_OPS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "in": lambda a, b: a in b,
    "not-in": lambda a, b: a not in b,
    "array_contains": lambda a, b: isinstance(a, list) and b in a,
    "array_contains_any": lambda a, b: isinstance(a, list) and any(v in a for v in b),
}


class _Query:
    def __init__(self, client, source, filters=(), orders=(), limit_n=None):
        self._client = client
        self._source = source  # ("collection", path) 或 ("group", name)
        self._filters = list(filters)
        self._orders = list(orders)
        self._limit = limit_n

    def _copy(self, **changes):
        q = _Query(self._client, self._source, self._filters, self._orders, self._limit)
        for key, value in changes.items():
            setattr(q, key, value)
        return q

    def where(self, field, op, value):
        if op not in _OPS:
            raise ValueError(f"不支援的查詢運算子：{op}")
        return self._copy(_filters=self._filters + [(field, op, value)])

    def order_by(self, field, direction=Query.ASCENDING):
        return self._copy(_orders=self._orders + [(field, direction)])

    def limit(self, n):
        return self._copy(_limit=n)

    def _matches(self, data):
        for field, op, value in self._filters:
            actual = _get_path(data, field)
            if actual is _MISSING:
                return False
            try:
                if not _OPS[op](actual, value):
                    return False
            except TypeError:  # 型別不同（例如 str 跟 datetime 比）視為不符合
                return False
        return True

    def stream(self, transaction=None):
        kind, name = self._source
        backend = self._client._backend
        rows = backend.list_collection(name) if kind == "collection" else backend.list_group(name)
        docs = [
            DocumentSnapshot(DocumentReference(self._client, pk, sk), data)
            for pk, sk, data in rows
            if self._matches(data)
        ]
        for field, direction in reversed(self._orders):
            docs = [d for d in docs if _get_path(d._data, field) is not _MISSING]
            docs.sort(key=lambda d: _get_path(d._data, field), reverse=direction == Query.DESCENDING)
        if self._limit is not None:
            docs = docs[: self._limit]
        return iter(docs)

    def get(self, transaction=None):
        return list(self.stream())


class CollectionReference(_Query):
    def __init__(self, client, path):
        super().__init__(client, ("collection", path))
        self.path = path
        self.id = path.rsplit("/", 1)[-1]

    def document(self, doc_id=None):
        return DocumentReference(self._client, self.path, doc_id or _auto_id())

    def add(self, data, document_id=None):
        ref = self.document(document_id)
        ref.set(data)
        return _now(), ref


class WriteBatch:
    # ponytail: 依序寫入、不是真的原子性；DynamoDB TransactWriteItems 上限 100 筆，需要時再換
    def __init__(self):
        self._ops = []

    def set(self, ref, data, merge=False):
        self._ops.append(lambda: ref.set(data, merge=merge))

    def update(self, ref, data):
        self._ops.append(lambda: ref.update(data))

    def delete(self, ref):
        self._ops.append(ref.delete)

    def create(self, ref, data):
        self._ops.append(lambda: ref.create(data))

    def commit(self):
        ops, self._ops = self._ops, []
        for op in ops:
            op()


class TransactionConflict(Exception):
    pass


class Transaction:
    """Materialize writes, then conditionally commit every document together."""
    def __init__(self, client):
        self._client = client
        self.reset()

    def reset(self):
        self._reads = {}
        self._snapshots = {}
        self._writes = {}

    def get(self, ref):
        if ref._client is not self._client:
            raise ValueError('Transaction cannot span clients')
        key = (ref._pk,ref.id)
        if key not in self._reads:
            data, token = self._client._backend.snapshot(*key)
            self._reads[key], self._snapshots[key] = token, data
        data = self._writes.get(key,self._snapshots[key])
        return DocumentSnapshot(ref,copy.deepcopy(data))

    def set(self, ref, data, merge=False):
        base = self.get(ref).to_dict()
        self._writes[(ref._pk,ref.id)] = _merge((base or {}) if merge else {},data)

    def update(self, ref, data):
        base = self.get(ref).to_dict()
        if base is None:
            raise NotFound(f'文件不存在：{ref.path}')
        self._writes[(ref._pk,ref.id)] = _apply_update(base,data)

    def create(self, ref, data):
        if self.get(ref).exists:
            raise ValueError(f'文件已存在：{ref.path}')
        self.set(ref,data)

    def delete(self, ref):
        self.get(ref)
        self._writes[(ref._pk,ref.id)] = None

    def commit(self):
        self._client._backend.atomic_commit(self._reads,self._writes)


# A process lock keeps local room mutations ordered. DynamoDB conditions also
# protect transactions from other processes and nontransactional document writes.
_TX_LOCK = threading.RLock()


def transactional(fn):
    @functools.wraps(fn)
    def wrapper(transaction, *args, **kwargs):
        for attempt in range(5):
            transaction.reset()
            try:
                with _TX_LOCK:
                    result = fn(transaction,*args,**kwargs)
                    transaction.commit()
                return result
            except TransactionConflict:
                if attempt == 4:
                    raise
                time.sleep(.01 * 2 ** attempt + random.uniform(0,.01))
    return wrapper


class Client:
    def __init__(self, backend):
        self._backend = backend

    def collection(self, name):
        return CollectionReference(self, name)

    def collection_group(self, name):
        return _Query(self, ("group", name))

    def batch(self):
        return WriteBatch()

    def transaction(self):
        return Transaction(self)


def client():
    """DOCSTORE=memory 用記憶體（測試 / 離線開發），其餘連 DynamoDB。"""
    if os.environ.get("DOCSTORE", "").lower() == "memory":
        return Client(_MemoryBackend())
    return Client(_DynamoBackend(DYNAMODB_TABLE))


if __name__ == "__main__":
    # 自我檢查：python docstore.py
    db = Client(_MemoryBackend())
    users = db.collection("users")
    users.document("u1").set({"handle": "a", "tags": ["x"], "n": 1, "m": {"k": 1, "j": 2}})
    users.document("u2").set({"handle": "b", "ended_at": _now()})
    users.document("u1").update({"tags": ArrayUnion(["y", "x"]), "n": Increment(2), "m.k": DELETE_FIELD,
                                 "created_at": SERVER_TIMESTAMP})
    d = users.document("u1").get().to_dict()
    assert d["tags"] == ["x", "y"] and d["n"] == 3 and d["m"] == {"j": 2}, d
    assert isinstance(d["created_at"], datetime.datetime) and d["created_at"].tzinfo
    users.document("u1").set({"m": {"z": 9}}, merge=True)
    assert users.document("u1").get().to_dict()["m"] == {"j": 2, "z": 9}
    assert [s.id for s in users.where("handle", "==", "b").stream()] == ["u2"]
    assert [s.id for s in users.where("tags", "array_contains", "y").stream()] == ["u1"]
    assert [s.id for s in users.order_by("handle", direction=Query.DESCENDING).limit(1).stream()] == ["u2"]
    users.document("u1").collection("meetings").document("m1").set({"ended_at": _now()})
    users.document("u2").collection("meetings").document("m2").set({"ended_at": _now()})
    since = _now() - datetime.timedelta(days=1)
    got = sorted(s.reference.path for s in db.collection_group("meetings").where("ended_at", ">=", since).stream())
    assert got == ["users/u1/meetings/m1", "users/u2/meetings/m2"], got

    tx = db.transaction()

    @transactional
    def bump(t):
        snap = users.document("u1").get(transaction=t)
        t.update(snap.reference, {"n": snap.to_dict()["n"] + 1})
    bump(tx)
    assert users.document("u1").get().to_dict()["n"] == 4
    try:
        users.document("nope").update({"a": 1})
        raise AssertionError("update 不存在的文件應該報錯")
    except NotFound:
        pass
    assert not users.document("nope").get().exists and users.document("nope").get().to_dict() is None
    print("docstore self-check OK")
