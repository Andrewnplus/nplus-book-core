# nplus-book-core

[![release](https://img.shields.io/github/v/release/nplus-father/nplus-book-core?style=flat-square)](https://github.com/nplus-father/nplus-book-core/releases)

Hugo Module，包在 [hugo-book](https://github.com/alex-shpak/hugo-book) 外面，
給 nplus.wiki 星系（約 1620 本書 + 11 本手冊）提供統一的色盤、元件與導覽。

## 安裝

書本站台的 `site/hugo.toml`：

```toml
[[module.imports]]
path = "github.com/nplus-father/nplus-book-core"

[params]
BookSection = "docs"
BookTheme   = "light"   # 必填 light：明暗切換由本模組的 SCSS 接管
locale      = "zh-Hant-TW"
```

`site/go.mod` **不要 require 本模組的版本**。全庫 1618 本裡有 318 本釘死了舊版，
結果拿不到任何主題更新，用了新 shortcode 還會 build 失敗。留空即可，Hugo 會在
build 時抓最新 tag。

## Shortcodes

### `book-cover`

書籍站首頁的開場。原始 `cover.png` 會照常發佈到 `/cover.png`（portal 與筆記站
靠那個網址取書封），版面上另外用 build 時產生的 WebP 縮圖。

```
{{< book-cover
title="直覺幫浦與其他思考工具"
src="cover.png"
author="Daniel C. Dennett"
date="April 29, 2013"
link="https://www.amazon.com/dp/B00AR354AQ" >}}
一到兩句簡介，30–75 字。
{{< /book-cover >}}
```

欄位規則（`src` 一律 `cover.png`、`date` 一律 `Month D, YYYY`、`link` 必須是
商品頁）見 `books-management/CLAUDE.md`。

### `book-overview`

四段深度概覽，JS 收成分頁。內文只寫 h2，段名自由：

```
{{% book-overview %}}

## 作者的位置
## 完整摘要
## 定位
## 這本書的限制

{{% /book-overview %}}
```

伺服器端輸出的永遠是四段完整可讀的 section，分頁是漸進增強。段名是資料契約——
`data-default`、分頁按鈕的中英對照表、`audit-overview.py` 的「四段齊全」都拿
中文段名比對。

### `note-cover`

多來源整合筆記的 hero 卡。參數：`title`（必填）、`src`、`tags`（逗號分隔）、
`doc1`–`doc5` 與 `docText1`–`docText5`、Inner 為 Markdown 說明。

## 數學公式

內文直接寫 `$…$`（行內）與 `$$…$$`（獨立一行的區塊），不用 `{{< katex >}}` shortcode，
也不要寫成 `\\(…\\)`。站台的 `site/hugo.toml` 要開 goldmark passthrough（模板已含）：

```toml
[markup.goldmark.extensions.passthrough]
enable = true
[markup.goldmark.extensions.passthrough.delimiters]
block = [['$$', '$$']]
inline = [['$', '$']]
```

這段沒辦法收進主題：Hugo 只把模組設定檔的 `params`、`menus`、`outputs` 等區段併進站台，
`markup` 不併。開了之後 `layouts/_markup/render-passthrough.html` 會在 build 時用
`transform.ToMath`（Hugo 內建 KaTeX）把公式轉成 HTML，瀏覽器只載 `katex.min.css`。

- 分隔符只收 `$`／`$$`，刻意不收 `\(`／`\[`：全庫有不少 `\[註\]` 這種 Markdown 跳脫，
  收了會被當成公式。
- `$` 同時是貨幣符號。hook 對「沒有反斜線、又含中文、或長得像 `$5 and $10`、`$100-$499`」
  的行內段原樣吐回，不當公式；`$$` 區塊一律當公式。
- 公式寫錯時 build 只會出 `WARN KaTeX: …`，頁面上以紅字顯示原文，不會讓 deploy 失敗。

## 校閱模式

側欄的「校閱」開關。開著的時候在內文選取文字會浮出四顆按鈕——**重點／修改／疑問／刪除**
（修改與疑問要先寫註記）——劃線存在瀏覽器的 localStorage，點既有劃線可以改種類、改註記或
刪除。右下角的面板可以「備註本章」（沒有選取範圍的整章指示）、勾「本章已讀」、**匯出**
（下載 JSON；手機上走系統分享）、複製 JSON 到剪貼簿、清除已匯出的標記。「本章已讀」以
頁面 frontmatter 為基線：源檔已標已讀的章節預設勾著，勾掉就是「取消已讀」；切回基線
不留標記。

匯出的檔案交給 `/book-apply-review` skill，它把標記變成源檔的改動：重點 → `<mark>`、
修改 → 依註記改稿、刪除 → 刪、疑問 → 討論後決定、已讀 → frontmatter `reviewed: true`、
取消已讀 → 移除 `reviewed` 與 `reviewed_date`。

設計上的幾個硬約束：

- 站台沒有後端，全庫又都在 `nplus.wiki` 同一個 origin 下，所以 localStorage 的 key 是
  `review:<station>`（station = baseURL 最後一段，跟 `/index.json` 同一個算法）；
  `review:mode` 記開關。本機 `hugoServer`（localhost）是另一個 origin，各存各的。
- 定位靠文字不靠 DOM：存選取原文 `exact` 加前後各 30 字 `prefix`／`suffix`。書改版後找
  不回來的標記在面板顯示「定位失敗」，仍會匯出。
- 劃線永遠顯示，工具列與面板只在開關開著時出現。

### 匯出格式（`nplus-review/1`）

```json
{
  "format": "nplus-review/1",
  "station": "say-it-with-charts",
  "site": "https://nplus.wiki/say-it-with-charts/",
  "book": "用圖表說話：經理人的視覺溝通指南",
  "exportedAt": "2026-09-07T08:00:00.000Z",
  "count": 3,
  "items": [
    {
      "id": "rvmf3k2abcd",
      "kind": "fix",
      "source": "docs/01-choosing-charts/02-identify-the-comparison/_index.md",
      "page": "/say-it-with-charts/docs/01-choosing-charts/02-identify-the-comparison/",
      "title": "辨識比較類型",
      "heading": "1. 成分比較（component comparison）",
      "headingId": "1-成分比較component-comparison",
      "exact": "我們主要關心的是每一部分占總體的百分比",
      "prefix": "成分比較（component comparison）",
      "suffix": "。例如：五月，產品 A 占公司總銷售的最大份額。",
      "note": "「占總體」改成「占整體」，跟第三章一致",
      "createdAt": "2026-09-07T07:12:03.412Z",
      "updatedAt": ""
    }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `kind` | `highlight`（重點）、`fix`（修改）、`question`（疑問）、`delete`（刪除）、`note`（整章備註，沒有 `exact`）、`reviewed`（本章已讀，沒有 `exact`）、`unreviewed`（取消已讀，沒有 `exact`） |
| `source` | 內容檔相對於 `site/content/` 的路徑，由 Hugo 的 `.File.Path` 寫進頁面，直接對回源檔 |
| `exact` | 選取的**渲染後**純文字，空白已壓成單一空格；源檔裡通常還帶著 `**`、連結等 Markdown 符號 |
| `prefix` / `suffix` | 前後各 30 字的上下文，用來在同一句出現多次時挑對位置 |
| `heading` / `headingId` | 選取範圍上方最近的標題與其錨點 |
| `note` | 使用者寫的註記；`fix` 與 `question` 必有 |

`items` 依 `source`、再依頁內位置排序。改欄位時 `assets/review.js` 的 `payload()`、這張表
與 skill 三邊要一起改。

## 站台參數

| 參數 | 預設 | 用途 |
|---|---|---|
| `stationKind` | `"book"` | 寫進 `/index.json` 的 `kind`。手冊要設 `"handbook"` |
| `hasReview` | 未設 | 側欄顯示「書評」連結 |
| `reviewUrl` | 由 baseURL 推導 | 覆寫書評連結網址 |

頁面 frontmatter 的 `reviewed: true`（或書本慣例的 `read: true`）會在側欄加上
已讀勾勾，並計入 `/index.json`。

## 檔案

| 路徑 | 內容 |
|---|---|
| `assets/_variables.scss` | **全站唯一的 token 來源**。所有隨明暗變動的值都在這裡的兩個 mixin |
| `assets/_custom.scss` | 元件樣式。不宣告 `:root`，也不寫 `[data-theme]` 選擇器 |
| `layouts/_partials/docs/inject/head.html` | 主題初始化（同步、防 FOUC）＋ 概覽分頁 JS ＋ KaTeX 樣式 |
| `layouts/_markup/render-passthrough.html` | `$…$` 公式的 render hook，build 時轉成 KaTeX HTML |
| `layouts/_partials/docs/inject/menu-before.html` | 側欄工具列：回 portal、書評、校閱開關、主題切換 |
| `layouts/_partials/docs/inject/body.html` | 校閱模式：把 station／source 寫進頁面並載入 `review.js` |
| `assets/review.js` | 校閱模式本體：劃線、註記、localStorage、匯出 |
| `layouts/_partials/docs/menu-filetree.html` | 上游整份 override，只加已讀勾勾。升級主題要對 diff |
| `layouts/index.json` | `/index.json`，portal 用來匯總 review 進度 |

## 改動主題後

1. **先 build 一本真的書驗過再發 tag。** Hugo 這條線用的是 libsass，`min()` 裡
   混用 `vw` 與 `px` 會直接中止整個 build，而錯誤只會在 build 時出現。
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. **既有的書不會自動更新**——deploy 是 push 觸發的。要散出去得對每個 book repo
   推一個 commit（空 commit 即可）。

---
© nplus.wiki
