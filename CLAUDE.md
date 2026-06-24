# CLAUDE.md

このリポジトリで作業する際のメモ・ガイドライン。

## 🎨 画像生成ツールの使い分け

画像を生成する時は用途に応じて以下から選択する。

### `gpt-image-2`（Codex 経由）
高品質・フォトリアル・キャラクター確定稿・テキスト入り画像に使う。
- **ルートA（サブスク内）**: `codex exec --dangerously-bypass-approvals-and-sandbox --cd <dir>` で
  Codex 組み込み `image_gen` ツールを呼ばせる。プロンプトに
  「API キーやスクリプトは書かないで、組み込みの image_gen ツールを直接使って」と明記する
- **ルートB（API 課金）**: `~/.codex/skills/.system/imagegen/scripts/image_gen.py` を直接叩く
- **制約**: 透過背景は非対応 → 必要なら `gpt-image-1.5` に切替。辺は16の倍数、最大3840px

### 軽量画像生成（例: Nano Banana 系など他 MCP）
軽量な草案・アイコン、既存画像の編集・合成、大量試作に使う。

### 判断の目安
| 用途 | 推奨 |
|------|------|
| 写真調の高品質シーン・人物・動物 | gpt-image-2 |
| テキスト/ロゴを含む画像 | gpt-image-2 |
| キャラクター確定稿 | gpt-image-2 |
| UI アイコン・軽量イラスト | 軽量ツール |
| 既存画像の編集・合成 | 軽量ツール |
| 透過背景が必要 | `gpt-image-1.5`（ルートB）または軽量ツール |

- 保存先: `docs/images/` 配下、命名は `<topic>-v<N>.png`
