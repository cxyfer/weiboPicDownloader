# weiboPicDownloader ![](https://img.shields.io/badge/python-2.7%7C3.4+-blue.svg)

(not real) weibo user album batch download tool (CLI)

build user album by picking all photos from original weibos in user's post feed

**Now supports downloading images from Supertopics (超话)!**

for more weibo free login APIs, turn to [wiki](https://github.com/nondanee/weiboPicDownloader/wiki)

**[中文 README](README-CN.md)**


## References

[yAnXImIN/weiboPicDownloader](https://github.com/yAnXImIN/weiboPicDownloader)  

[ningshu/weiboPicDownloader](https://github.com/ningshu/weiboPicDownloader) 

## Overview

![](https://user-images.githubusercontent.com/26399680/51592598-fd48b980-1f2a-11e9-9687-4670e7dfcd83.png)

## Dependencies

```
$ pip install requests
$ pip install colorama # only windows version under 10.0.14393 required
$ pip install futures # only python2 environment required
```

## Usage

```
$ python .\weiboPicDownloader.py -h
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

Required argument (choose one)

- `-u user ...` users (nickname or id)
- `-f file ...` user list files (nickname or id, separated by linefeed in the file)
- `-t topic ...` supertopic names or container IDs (e.g., `黄怡慈` or `100808bb9cd1a4f4e71095340183c2c51749a2`)

Optional arguments

- `-d directory` media saving path (default value: `./weiboPic`)
- `-s size` thread pool size (default value: `20`)
- `-r retry` max retries (default value: `2`)
- `-i interval` request interval (default value: `1`, unit: second)
- `-c cookie` login credential. You can pass either:
  - a file path containing cookies (preferred). The file may contain the full cookie string (e.g. `SUB=...; SUBP=...; XSRF-TOKEN=...`) or only the `SUB` value.
  - a raw cookie string. If it contains `=` or `;`, it will be sent as-is. Otherwise it is treated as the `SUB` value.

Notes:
- Accessing `m.weibo.cn` APIs usually requires valid cookies (at least `SUB`). Without cookies you may be redirected to a visitor gate and receive empty results.
- `-b boundary` mid/bid/date range of weibos (format: `id:id` between, `:id` before, `id:` after, `id` certain, `:` all)
- `-n name` naming template (identifier: `url`, `index`, `type`, `mid`, `bid`, `date`, `text`, `name`, like ["f-Strings"](https://www.python.org/dev/peps/pep-0498/#abstract) syntax)
- `-v` download miaopai videos at the same time
- `-o` overwrite existing files (skipping if exists for default)

✳How to get the value of `SUB` from browser (Chrome for example)

1. jump to https://m.weibo.cn and log in
2. inspect > Application > Cookies > https://m.weibo.cn
3. double click the `SUB` line and copy its value
4. paste it into terminal and run like  `-c <value>`

## How to provide cookies (Chrome example)

1. Open https://m.weibo.cn and log in
2. DevTools > Application > Cookies > https://m.weibo.cn
3. Copy the entire Cookie string (recommended), or at least the `SUB` value
4. Provide via `-c`:
   - File: save cookies to `cookie.txt`, then `-c cookie.txt`
   - Raw: `-c "SUB=...; SUBP=...; XSRF-TOKEN=..."` or `-c "<SUB value>"`

## Supertopic Download Examples

```bash
# Download by supertopic name (use Simplified Chinese)
python weiboPicDownloader.py -t 黄怡慈 -b 20251220:

# Download by container ID
python weiboPicDownloader.py -t 100808bb9cd1a4f4e71095340183c2c51749a2 -b 20251220:

# With interval to avoid rate limiting
python weiboPicDownloader.py -t 黄怡慈 -b 20251220: -i 2

# With custom cookie
python weiboPicDownloader.py -t 黄怡慈 -c cookies.txt -b 20251220:
```

Note: Supertopic images will be saved to `topic/<supertopic_name>/` folder.
