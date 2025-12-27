# weiboPicDownloader

![Python Version](https://img.shields.io/badge/python-3.6+-blue.svg)
![License](https://img.shields.io/badge/license-GPL--3.0-green.svg)

Batch download tool for Weibo user photos (CLI)

Build user album by picking all photos from original weibos in user's post feed.

**[中文文檔](README-CN.md)**

## ✨ Features

- 📸 Download all photos from a Weibo user's posts
- 🎬 Optional video download support
- 📂 Download from Supertopics (超话)
- 🔄 Automatic cookie refresh via Selenium
- 🧵 Multi-threaded downloading
- 📅 Date range filtering

## 📦 Installation

### Requirements

```bash
pip install requests
```

### Optional Dependencies

```bash
# For automatic cookie fetching (recommended)
pip install selenium webdriver-manager

# For Windows versions below 10.0.14393
pip install colorama
```

> [!TIP]
> Installing `selenium` and `webdriver-manager` enables automatic cookie management, which is highly recommended for a smoother experience.

## 🚀 Usage

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
  -c cookie             set cookie or cookie file (file path preferred)
  -b boundary           focus on weibos in the id range
  -n name               customize naming format
  -v                    download videos together
  -o                    overwrite existing files
```

### Required Arguments (choose one)

| Argument | Description |
|----------|-------------|
| `-u user ...` | Users (nickname or UID) |
| `-f file ...` | User list files (one per line) |
| `-t topic ...` | Supertopic names or container IDs |

### Optional Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `-d directory` | `./weiboPic` | Media saving path |
| `-s size` | `20` | Thread pool size |
| `-r retry` | `2` | Max retries |
| `-i interval` | `1` | Request interval (seconds) |
| `-c cookie` | - | Login credential (file or string) |
| `-b boundary` | `:` | Date/ID range filter |
| `-n name` | `{date}_{name}` | Naming template |
| `-v` | - | Download videos |
| `-o` | - | Overwrite existing files |

### Boundary Format

| Format | Description |
|--------|-------------|
| `id:id` | Between two dates/IDs |
| `:id` | Before date/ID |
| `id:` | After date/ID |
| `id` | Specific date/ID |
| `:` | All (no filter) |

### Naming Template

Use identifiers like `{url}`, `{index}`, `{type}`, `{mid}`, `{bid}`, `{date}`, `{text}`, `{name}` in [f-string](https://www.python.org/dev/peps/pep-0498/) style.

## 🍪 How to Provide Cookies

> [!IMPORTANT]
> Accessing `m.weibo.cn` APIs usually requires valid cookies (at least `SUB`). Without cookies, you may receive empty results.

### Method 1: Cookie File (Recommended)

1. Open https://m.weibo.cn and log in
2. DevTools → Application → Cookies → https://m.weibo.cn
3. Copy the entire Cookie string or at least the `SUB` value
4. Save to a file (e.g., `cookie.txt`)
5. Use: `-c cookie.txt`

### Method 2: Direct String

```bash
python weiboPicDownloader.py -u <user> -c "SUB=...; SUBP=...; XSRF-TOKEN=..."
```

## 📂 Supertopic Download Examples

```bash
# Download by supertopic name
python weiboPicDownloader.py -t 超话名称 -b 20251220:

# Download by container ID
python weiboPicDownloader.py -t 100808bb9cd1a4f4e71095340183c2c51749a2 -b 20251220:

# With interval to avoid rate limiting
python weiboPicDownloader.py -t 超话名称 -b 20251220: -i 2

# With custom cookie
python weiboPicDownloader.py -t 超话名称 -c cookies.txt -b 20251220:
```

> [!NOTE]
> Supertopic images will be saved to `topic/<supertopic_name>/` folder.

## 📁 Project Structure

```
weiboPicDownloader/
├── weiboPicDownloader.py      # Entry point (backward compatible)
├── weiboPicDownloader/        # Main package
│   ├── __init__.py
│   ├── __main__.py           # python -m support
│   ├── cli.py                # CLI interface
│   ├── constants.py          # Shared constants
│   ├── cookie_fetcher.py     # Selenium cookie helper
│   ├── scraper.py            # Core scraping logic
│   └── utils.py              # Utility functions
└── README.md
```

## 🔗 References

- [yAnXImIN/weiboPicDownloader](https://github.com/yAnXImIN/weiboPicDownloader)
- [ningshu/weiboPicDownloader](https://github.com/ningshu/weiboPicDownloader)
- [Weibo API Wiki](https://github.com/nondanee/weiboPicDownloader/wiki)

## 📄 License

GPL-3.0
