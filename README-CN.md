# 微博圖片批量下載工具

![Python Version](https://img.shields.io/badge/python-3.6+-blue.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)

批量下載微博用戶圖片的命令列工具 (CLI)

從用戶微博貼文中提取所有原圖，建立用戶相簿。

**[English README](README.md)**

## ✨ 功能特色

- 📸 下載用戶所有微博圖片
- 🎬 支援下載視頻
- 📂 支援超話圖片下載
- 🔄 自動刷新 Cookie（Selenium）
- 🧵 多線程下載
- 📅 日期範圍篩選

## 📦 安裝

### 必要依賴

```bash
pip install requests
```

### 可選依賴

```bash
# 自動獲取 Cookie（推薦）
pip install selenium webdriver-manager

# Windows 10.0.14393 以下版本需要
pip install colorama
```

> [!TIP]
> 安裝 `selenium` 和 `webdriver-manager` 可啟用自動 Cookie 管理，強烈推薦安裝。

## 🚀 使用方法

```bash
python weiboPicDownloader.py -h
```

```
usage: weiboPicDownloader [-h] (-u user [user ...] | -f file [file ...] | -t topic [topic ...])
                          [-d directory] [-s size] [-r retry] [-i interval]
                          [-c cookie] [-b boundary] [-n name] [-v] [-o]

optional arguments:
  -h, --help            show this help message and exit
  -u user [user ...]    specify nickname or id of weibo users
  -f file [file ...]    import list of users from files
  -t topic [topic ...]  specify supertopic name or container id (100808...)
  -d directory          set picture saving path
  -s size               set size of thread pool
  -r retry              set maximum number of retries
  -i interval           set interval for feed requests
  -c cookie             設置 Cookie 或 Cookie 文件（優先識別文件路徑）
  -b boundary           focus on weibos in the id range
  -n name               customize naming format
  -v                    download videos together
  -o                    overwrite existing files
```

### 必需參數（任選一）

| 參數 | 說明 |
|------|------|
| `-u user ...` | 用戶（暱稱或 UID） |
| `-f file ...` | 用戶列表文件（每行一個） |
| `-t topic ...` | 超話名稱或 Container ID |

### 可選參數

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `-d directory` | `./weiboPic` | 圖片保存路徑 |
| `-s size` | `20` | 線程池大小 |
| `-r retry` | `2` | 最大重試次數 |
| `-i interval` | `1` | 請求間隔（秒） |
| `-c cookie` | - | 登入憑據（文件或字串） |
| `-b boundary` | `:` | 日期/ID 範圍篩選 |
| `-n name` | `{date}_{name}` | 命名模板 |
| `-v` | - | 下載視頻 |
| `-o` | - | 覆蓋已存在的文件 |

### 日期範圍格式

| 格式 | 說明 |
|------|------|
| `id:id` | 兩個日期/ID 之間 |
| `:id` | 此日期/ID 之前 |
| `id:` | 此日期/ID 之後 |
| `id` | 指定日期/ID |
| `:` | 全部（無篩選） |

### 命名模板

使用 [f-string](https://www.python.org/dev/peps/pep-0498/) 風格的標識符：`{url}`、`{index}`、`{type}`、`{mid}`、`{bid}`、`{date}`、`{text}`、`{name}`

## 🍪 如何提供 Cookie

> [!IMPORTANT]
> 訪問 `m.weibo.cn` API 通常需要有效的 Cookie（至少需要 `SUB`）。沒有 Cookie 可能會收到空結果。

### 方法一：Cookie 文件（推薦）

1. 打開 https://m.weibo.cn 並登入
2. 開發者工具 → Application → Cookies → https://m.weibo.cn
3. 複製整個 Cookie 字串或至少複製 `SUB` 的值
4. 保存到文件（如 `cookie.txt`）
5. 使用：`-c cookie.txt`

### 方法二：直接字串

```bash
python weiboPicDownloader.py -u <用戶> -c "SUB=...; SUBP=...; XSRF-TOKEN=..."
```

## 📂 超話下載示例

```bash
# 通過超話名稱下載
python weiboPicDownloader.py -t 超话名称 -b 20251220:

# 通過 Container ID 下載
python weiboPicDownloader.py -t 100808bb9cd1a4f4e71095340183c2c51749a2 -b 20251220:

# 增加請求間隔以避免限流
python weiboPicDownloader.py -t 超话名称 -b 20251220: -i 2

# 使用自定義 Cookie
python weiboPicDownloader.py -t 超话名称 -c cookies.txt -b 20251220:
```

> [!NOTE]
> 超話圖片將保存到 `topic/<超話名稱>/` 文件夾中。

## 📁 專案結構

```
weiboPicDownloader/
├── weiboPicDownloader.py      # 入口點（向後相容）
├── weiboPicDownloader/        # 主套件
│   ├── __init__.py
│   ├── __main__.py           # python -m 支援
│   ├── cli.py                # CLI 介面
│   ├── constants.py          # 共用常數
│   ├── cookie_fetcher.py     # Selenium Cookie 助手
│   ├── scraper.py            # 核心爬蟲邏輯
│   └── utils.py              # 工具函數
└── README.md
```

## 🔗 參考

- [yAnXImIN/weiboPicDownloader](https://github.com/yAnXImIN/weiboPicDownloader)
- [ningshu/weiboPicDownloader](https://github.com/ningshu/weiboPicDownloader)
- [Weibo API Wiki](https://github.com/nondanee/weiboPicDownloader/wiki)

## 📄 授權

GPL-3.0
