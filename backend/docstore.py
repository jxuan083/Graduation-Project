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

    def get(self, pk, sk):
        item = self._table.get_item(Key={"pk": pk, "sk": sk}).get("Item")
        return _loads(item["data"]) if item else None

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
        raw = self._items.get((pk, sk))
        return _loads(raw) if raw else None

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
        return DocumentSnapshot(self, self._client._backend.get(self._pk, self.id))

    def set(self, data, merge=False):
        backend = self._client._backend
        base = (backend.get(self._pk, self.id) or {}) if merge else {}
        backend.put(self._pk, self.id, _merge(base, data))

    def update(self, data):
        backend = self._client._backend
        current = backend.get(self._pk, self.id)
        if current is None:
            raise NotFound(f"文件不存在：{self.path}")
        backend.put(self._pk, self.id, _apply_update(current, data))

    def create(self, data):
        if self._client._backend.get(self._pk, self.id) is not None:
            raise ValueError(f"文件已存在：{self.path}")
        self.set(data)

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


class Transaction(WriteBatch):
    pass


# ponytail: 全域鎖，後端只跑一個 process（WebSocket 房間狀態本來就是 process-local）；
# 要多台機器時改成 DynamoDB 條件寫入（version 欄位）
_TX_LOCK = threading.RLock()


def transactional(fn):
    def wrapper(transaction, *args, **kwargs):
        with _TX_LOCK:
            result = fn(transaction, *args, **kwargs)
            transaction.commit()
            return result
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
        return Transaction()


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
