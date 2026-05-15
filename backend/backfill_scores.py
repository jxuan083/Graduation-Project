"""
回溯補分數 + 寫入 users/{uid}/meetings 鏡像

用途：Phase 2 上線前，把已經存在的 meetings 文件補上 base_score / host_score，
     並且幫每個 participant 在 users/{uid}/meetings/{meeting_id} 底下建立鏡像
     （這份鏡像是排行榜 query 的來源）

執行：
  PowerShell / CMD:
    set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
    python backfill_scores.py
  bash/zsh:
    GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json python backfill_scores.py

安全性：
  - 只寫入尚未有 score 欄位的 meeting；已經有的會跳過（idempotent）
  - 鏡像用 set(merge=True)，重複執行不會損毀資料
"""
import os
import sys
import firebase_admin
from firebase_admin import credentials, firestore


def _compute_meeting_score(duration_minutes: int, deviations: int, is_host: bool) -> int:
    focus_points = max(0, 50 - int(deviations) * 5)
    participation_points = int(duration_minutes) * 0.5
    bonus = 10 if (int(deviations) == 0 and int(duration_minutes) >= 20) else 0
    host_bonus = 5 if is_host else 0
    return int(round(focus_points + participation_points + bonus + host_bonus))


def main():
    # 初始化 Firebase
    if not firebase_admin._apps:
        key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "serviceAccountKey.json")
        if not os.path.exists(key_path):
            print(f"[ERROR] 找不到 service account key: {key_path}")
            print("請確認 GOOGLE_APPLICATION_CREDENTIALS 環境變數有指到正確的 key 檔")
            sys.exit(1)
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
        print(f"[init] Firebase 初始化完成，使用 key: {key_path}")

    db = firestore.client()

    total = 0
    updated = 0
    mirrored = 0
    skipped = 0

    print("[scan] 開始掃描 meetings collection...")
    for doc in db.collection("meetings").stream():
        total += 1
        d = doc.to_dict() or {}
        mid = doc.id
        duration = int(d.get("duration_minutes", 0) or 0)
        deviations = int(d.get("total_deviations", 0) or 0)
        host_uid = d.get("host_uid")
        participants = d.get("participants") or []

        # 如果還沒有 base_score，補上
        has_base = d.get("base_score") is not None
        has_host = d.get("host_score") is not None
        base_score = _compute_meeting_score(duration, deviations, is_host=False)
        host_score = _compute_meeting_score(duration, deviations, is_host=True)

        if not (has_base and has_host):
            try:
                db.collection("meetings").document(mid).set({
                    "base_score": base_score,
                    "host_score": host_score,
                }, merge=True)
                updated += 1
                print(f"  [meeting] {mid} → base={base_score} host={host_score}")
            except Exception as e:
                print(f"  [ERROR] 更新 meeting {mid} 失敗: {e}")
                continue
        else:
            skipped += 1

        # 幫每個 participant 寫鏡像（如果還沒有）
        ended_at = d.get("ended_at")
        for p_uid in participants:
            mirror_ref = db.collection("users").document(p_uid) \
                .collection("meetings").document(mid)
            if mirror_ref.get().exists:
                continue
            my_score = host_score if p_uid == host_uid else base_score
            mirror = {
                "owner_uid": p_uid,
                "room_id": mid,
                "is_host": (p_uid == host_uid),
                "mode": d.get("mode", ""),
                "ended_at": ended_at,
                "duration_minutes": duration,
                "deviations": deviations,
                "score": my_score,
            }
            try:
                mirror_ref.set(mirror, merge=True)
                mirrored += 1
            except Exception as e:
                print(f"  [ERROR] 寫鏡像 {p_uid}/{mid} 失敗: {e}")

    print("")
    print("=" * 50)
    print(f"[done] 掃描完成")
    print(f"  總 meeting 數：{total}")
    print(f"  更新 score：{updated}  已有 score 跳過：{skipped}")
    print(f"  建立個人鏡像：{mirrored}")
    print("=" * 50)


if __name__ == "__main__":
    main()
