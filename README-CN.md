# (免)登录下载微博图片 ![](https://img.shields.io/badge/python-2.7%7C3.4+-blue.svg)

批量下载微博用户图片 (CLI)

**现已支持下载超话图片！**

只对免登录接口感兴趣的话，直接看 [wiki](https://github.com/nondanee/weiboPicDownloader/wiki) 不用谢

## 致谢

根源自 Java 项目 [yAnXImIN/weiboPicDownloader](https://github.com/yAnXImIN/weiboPicDownloader)  

也从另一移植项目学到了好多 [ningshu/weiboPicDownloader](https://github.com/ningshu/weiboPicDownloader) 

非常感谢两位巨巨

## 预览

![](https://user-images.githubusercontent.com/26399680/51592598-fd48b980-1f2a-11e9-9687-4670e7dfcd83.png)

## 依赖

```
$ pip install requests
$ pip install colorama # 仅 Windows 10.0.14393 以下需要
$ pip install futures # 仅 Python2 需要
```

## 使用

```
$ python weiboPicDownloader.py -h
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
  -c cookie             设置 Cookie 或 Cookie 文件（优先识别文件路径）
  -b boundary           focus on weibos in the id range
  -n name               customize naming format
  -v                    download videos together
  -o                    overwrite existing files
```

必需参数（任选一）

- `-u user` 用户（昵称或 id）
- `-f file` 用户列表文件（昵称或 id，一个用户占一行）
- `-t topic` 超话名称或 Container ID（如 `黄怡慈` 或 `100808bb9cd1a4f4e71095340183c2c51749a2`）

可选参数

- `-d directory` 图片保存路径（默认值：`./weiboPic`）
- `-s size` 线程池大小（默认值：`20`）
- `-r retry` 最大重试次数（默认值：`2`）
- `-i interval` 请求间隔（默认值：`1`，单位：秒）
- `-c cookie` 登录凭据 (需要 cookie 中的 `SUB` 值)
- `-b boundary` 微博 mid/bid 或日期范围（格式：`id:id` 两者之间，`:id` 之前，`id:` 之后，`id` 指定，`:` 全部）
- `-n name` 命名模板 (标识符: `url`、`index`、`type`、`mid`、`bid`、`date`、`text`、`name`，类似 ["f-Strings"](https://www.python.org/dev/peps/pep-0498/#abstract) 语法)
- `-v` 同时下载秒拍视频
- `-o` 重新下载已保存的文件（默认跳过）

✳如何从浏览器中取得 `SUB` 的值（以 Chrome 举例）

1. 转到 https://m.weibo.cn 并登录
2. 右键检查 > Application > Cookies > https://m.weibo.cn
3. 双击 `SUB` 所在行并右键拷贝它的值
4. 将 `SUB` 的值粘贴到命令行窗口，以 `-c <value>` 的方式运行程序

## 如何提供 Cookie（Chrome 举例）

1. 打开 https://m.weibo.cn 并登录
2. 开发者工具 > Application > Cookies > https://m.weibo.cn
3. 复制整个 Cookie 字符串（推荐），或至少复制 `SUB` 的值
4. 通过 `-c` 提供：
   - 文件：将 Cookie 保存到 `cookie.txt`，然后 `-c cookie.txt`
   - 字符串：`-c "SUB=...; SUBP=...; XSRF-TOKEN=..."` 或 `-c "<SUB 值>"`

## 超话下载示例

```bash
# 通过超话名称下载
python weiboPicDownloader.py -t {超话名称} -b 20251220:

# 通过 Container ID 下载
python weiboPicDownloader.py -t {container_id} -b 20251220:

# 增加请求间隔以避免限流
python weiboPicDownloader.py -t {超话名称} -b 20251220: -i 2

# 使用自定义 Cookie
python weiboPicDownloader.py -t {超话名称} -c cookies.txt -b 20251220:
```

注意：超话图片将保存到 `topic/<超话名称>/` 文件夹中。
