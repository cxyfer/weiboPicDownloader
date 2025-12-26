# -*- coding: utf-8 -*-

import sys
import os
import json
import re
import datetime
import math
import time
import concurrent.futures
import requests
import argparse
from urllib.parse import urlparse
import traceback
import logging

logger = logging.getLogger(__name__)

# Selenium imports
HAS_SELENIUM = False
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from webdriver_manager.chrome import ChromeDriverManager
    HAS_SELENIUM = True
except ImportError:
    pass

# Disable SSL warnings
try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    pass

# Constants
MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
DEFAULT_HEADERS = {
    'User-Agent': MOBILE_USER_AGENT,
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'MWeibo-Pwa': '1',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
}

parser = argparse.ArgumentParser(prog='weiboPicDownloader')
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument('-u', metavar='user', dest='users', nargs='+', help='specify nickname or id of weibo users')
group.add_argument('-f', metavar='file', dest='files', nargs='+', help='import list of users from files')
group.add_argument('-t', metavar='topic', dest='topics', nargs='+', help='specify supertopic name or container id (100808...)')
parser.add_argument('-d', metavar='directory', dest='directory', help='set picture saving path')
parser.add_argument('-s', metavar='size', dest='size', default=20, type=int, help='set size of thread pool')
parser.add_argument('-r', metavar='retry', dest='retry', default=2, type=int, help='set maximum number of retries')
parser.add_argument('-i', metavar='interval', dest='interval', default=1, type=float, help='set interval for feed requests')
parser.add_argument('-c', metavar='cookie', dest='cookie', help='set cookie if needed')
parser.add_argument('-b', metavar='boundary', dest='boundary', default=':', help='focus on weibos in the id range')
parser.add_argument('-p', metavar='pages', dest='pages', default=0, type=int, help='set max pages to fetch (0 for unlimited)')
parser.add_argument('-n', metavar='name', dest='name', default='{date}_{name}', help='customize naming format')
parser.add_argument('-v', dest='video', action='store_true', help='download videos together')
parser.add_argument('-o', dest='overwrite', action='store_true', help='overwrite existing files')


class CookieFetcher:
    """Fetches cookies using Selenium to bypass JS challenges."""
    
    def __init__(self):
        if not HAS_SELENIUM:
            print("Error: Selenium or webdriver-manager is not installed.")
            print("Please run: pip install selenium webdriver-manager")
            sys.exit(1)

    def fetch_cookies(self):
        print("Launching browser to fetch cookies...")
        options = Options()
        if os.environ.get("HEADLESS_MODE") != "0": # Allow debug by setting env HEADLESS_MODE=0
            options.add_argument('--headless')
        options.add_argument('--disable-gpu')
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        # Anti-detection
        options.add_argument('--disable-blink-features=AutomationControlled')
        options.add_argument(f'user-agent={MOBILE_USER_AGENT}')
        
        driver = None
        try:
            # Automatically install/manage driver
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
            
            driver.get('https://m.weibo.cn/')
            
            # Wait for key cookie or just a bit of time for JS to run
            try:
                # Wait up to 10s for the M_WEIBOCN_PARAMS or similar cookie
                WebDriverWait(driver, 10).until(
                   lambda d: 'm.weibo.cn' in d.current_url
                )
            except Exception:
                pass
            
            # Additional small sleep to ensure _T_WM is set
            time.sleep(2)
            
            selenium_cookies = driver.get_cookies()
            cookie_dict = {}
            for cookie in selenium_cookies:
                cookie_dict[cookie['name']] = cookie['value']
            
            print("Cookies fetched successfully.")
            return cookie_dict
            
        except Exception as e:
            print("\n!!! Selenium Error Traceback !!!")
            traceback.print_exc()
            print(f"Failed to fetch cookies via Selenium.")
            return None
        finally:
            if driver:
                try:
                    driver.quit()
                except:
                    pass


class WeiboScraper:
    def __init__(self, cookie=None):
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.session.verify = False
        self.cookie_fetcher = None
        self.manual_cookie = False
        
        if cookie:
            self.session.headers['Cookie'] = cookie
            self.manual_cookie = True
        else:
            # Init automator
            self.cookie_fetcher = CookieFetcher()
            cookies = self.cookie_fetcher.fetch_cookies()
            if cookies:
                requests.utils.add_dict_to_cookiejar(self.session.cookies, cookies)

    def request(self, method, url, allow_redirects=True, retry_auth=True):
        try:
            resp = self.session.request(method, url, timeout=10, allow_redirects=allow_redirects)
            
            # Check for soft-block (ok: -100) or HTTP 418/403
            is_blocked = False
            if resp.status_code in [403, 418]:
                is_blocked = True
            elif resp.status_code == 200:
                try:
                    # Only check JSON for API endpoints
                    if 'api/container/getIndex' in url:
                        data = resp.json()
                        if data.get('ok') == -100:
                            is_blocked = True
                except:
                    pass
            
            if is_blocked and retry_auth and not self.manual_cookie and self.cookie_fetcher:
                print("\nAccess denied (Cookie expired or invalid). Refreshing cookies...")
                new_cookies = self.cookie_fetcher.fetch_cookies()
                if new_cookies:
                    self.session.cookies.clear()
                    requests.utils.add_dict_to_cookiejar(self.session.cookies, new_cookies)
                    # Retry once
                    return self.request(method, url, allow_redirects, retry_auth=False)
                else:
                    print("Failed to refresh cookies.")

            return resp
            
        except requests.RequestException as e:
            if retry_auth: # Simple retry for network errors
               print(f'Network error: {e}, retrying...')
               time.sleep(1)
               return self.request(method, url, allow_redirects, retry_auth=False)
            print(f'Request failed: {e}')
            return None

    def prime_cookies(self, uid):
        """Visits the user profile page to initialize visitor cookies if manual/headless failed."""
        if self.manual_cookie: return
        url = f'https://m.weibo.cn/u/{uid}'
        try:
             self.session.get(url, headers={'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'})
        except:
             pass

    def nickname_to_uid(self, nickname):
        """Resolves a nickname to a UID using m.weibo.cn redirect."""
        url = f'https://m.weibo.cn/n/{nickname}'
        try:
            # allow_redirects=False is key for 302
            resp = self.request('GET', url, allow_redirects=False)
            if resp and resp.status_code == 302:
                loc = resp.headers.get('Location', '')
                match = re.search(r'/u/(\d+)', loc)
                if match:
                    return match.group(1)
        except Exception as e:
            print(f"Error resolving nickname: {e}")
        return None

    def uid_to_nickname(self, uid):
        """Fetches nickname from UID using getIndex API."""
        self.prime_cookies(uid)
        url = f'https://m.weibo.cn/api/container/getIndex?type=uid&value={uid}'
        resp = self.request('GET', url)
        if resp and resp.status_code == 200:
            try:
                data = resp.json()
                if data.get('ok') == 1:
                    return data['data']['userInfo']['screen_name']
            except (KeyError, ValueError, IndexError):
                pass
        return str(uid)

    def get_containerid(self, uid):
        """Finds the containerid for the 'Weibo' (posts) tab."""
        self.prime_cookies(uid)
        url = f'https://m.weibo.cn/api/container/getIndex?type=uid&value={uid}'
        resp = self.request('GET', url)
        if resp and resp.status_code == 200:
            try:
                data = resp.json()
                if data.get('ok') == 1:
                    tabs = data['data'].get('tabsInfo', {}).get('tabs', [])
                    for tab in tabs:
                        if tab.get('tab_type') == 'weibo':
                            return tab.get('containerid')
            except Exception:
                pass
        return f'107603{uid}'

    def search_supertopic(self, keyword):
        """Search for a supertopic by keyword and return (containerid, name)."""
        from urllib.parse import quote
        encoded_keyword = quote(keyword)
        url = f'https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D98%26q%3D{encoded_keyword}&page_type=searchall'
        
        resp = self.request('GET', url)
        if resp and resp.status_code == 200:
            try:
                data = resp.json()
                if data.get('ok') == 1:
                    cards = data['data'].get('cards', [])
                    for card in cards:
                        card_group = card.get('card_group', [])
                        for item in card_group:
                            scheme = item.get('scheme', '')
                            # Extract container ID (100808...) from scheme URL
                            match = re.search(r'100808[a-f0-9]+', scheme)
                            if match:
                                topic_name = item.get('title_sub', '') or item.get('desc1', '') or keyword
                                return match.group(0), topic_name
            except Exception as e:
                print(f'Error searching supertopic: {e}')
        return None, None

    def get_supertopic_name_by_id(self, containerid):
        """Get supertopic name from container ID."""
        url = f'https://m.weibo.cn/api/container/getIndex?containerid={containerid}'
        
        resp = self.request('GET', url)
        if resp and resp.status_code == 200:
            try:
                data = resp.json()
                if data.get('ok') == 1:
                    page_info = data.get('data', {}).get('pageInfo', {})
                    # Try multiple possible fields
                    topic_name = page_info.get('title_top') or \
                                 page_info.get('nick') or \
                                 page_info.get('page_title') or \
                                 containerid
                    return topic_name
            except Exception as e:
                print(f'Error getting supertopic name: {e}')
        return containerid  # Return containerid as fallback

    def get_supertopic_resources(self, containerid, video, interval, limit, max_pages=0):
        """Fetch resources from a supertopic using Feed API."""
        print(f'Fetching supertopic posts for containerid: {containerid}')
        
        page = 1
        resources = []
        finish = False
        empty_count = 0
        
        while not finish and empty_count < 3 and (max_pages == 0 or page <= max_pages):
            # Use feed endpoint with page parameter
            url = f'https://m.weibo.cn/api/container/getIndex?containerid={containerid}_-_feed&page={page}'
            print(f"Fetch from {url}")
            resp = self.request('GET', url)
            
            if not resp or resp.status_code != 200:
                print(f'Failed to fetch page {page}, stopping.')
                break
                
            try:
                data = resp.json()
                ok = data.get('ok')
                
                if ok == -100:
                    print("Error: Access denied (Login Required).")
                    print("Trying manual cookie is recommended if auto-fetch fails.")
                    break
                     
                if ok != 1:
                    # End of feed usually returns ok=0
                    print('End of feed.')
                    break
                    
                cards = data['data'].get('cards', [])
                if not cards:
                    print(f"Page {page} is empty.")
                    empty_count += 1
                    page += 1
                    continue
                else:
                    empty_count = 0

                # Extract card_group from cards, and append to cards
                for card in cards[:]:
                    cards.extend(card.get('card_group', []))
                    
                for card in cards:
                    if int(card.get('card_type')) != 9:
                        continue
                        
                    mblog = card.get('mblog')
                    if not mblog:
                        continue

                    mid = str(mblog['id'])
                    date = self.parse_date(mblog.get('latest_update', mblog.get('edit_at', mblog.get('created_at', ''))))

                    # Boundary Check (no pinned post check for supertopics)
                    if limit[1] != float('inf') and date > limit[1]:
                        continue
                    if limit[0] != 0 and date < limit[0]:
                        finish = True
                        logger.debug(f"Boundary Check: {date} < {limit[0]}")
                        print(f"Boundary Check: {date} < {limit[0]}")
                        break
                        
                    mark = {'mid': mid, 'date': date, 'text': mblog.get('text', '')}
                    
                    # Photos
                    if 'pics' in mblog:
                        for idx, pic in enumerate(mblog['pics'], 1):
                            if 'large' in pic:
                                pic_url = pic['large']['url']
                                resources.append({**mark, 'url': pic_url, 'index': idx, 'type': 'photo'})
                    
                    # Videos
                    if video and 'page_info' in mblog:
                        page_info = mblog['page_info']
                        if page_info.get('type') == 'video':
                            media_info = page_info.get('media_info', {})
                            video_url = media_info.get('stream_url_hd') or \
                                        media_info.get('mp4_720p_mp4') or \
                                        media_info.get('mp4_hd_url') or \
                                        media_info.get('stream_url')
                            
                            if video_url:
                                resources.append({**mark, 'url': video_url, 'index': 1, 'type': 'video'})
                                
            except Exception as e:
                print(f'Error parsing page {page}: {e}')
                
            print(f'Page {page} analyzed. Total resources: {len(resources)}', end='\r')
            page += 1
            time.sleep(interval)
            
        print(f'\nFinished scanning. Total {len(resources)} items.')
        return resources

    def parse_date(self, text):
        now = datetime.datetime.now()
        try:
            # Handle "Mon Dec 01 19:13:30 +0800 2025"
            return datetime.datetime.strptime(text, '%a %b %d %H:%M:%S %z %Y').date()
        except ValueError:
            if '前' in text:
                match = re.search(r'\d+', text)
                if match:
                    num = int(match.group())
                    if '分钟' in text or 'min' in text:
                        return (now - datetime.timedelta(minutes=num)).date()
                    elif '小时' in text or 'hour' in text:
                        return (now - datetime.timedelta(hours=num)).date()
                return now.date()
            elif '昨天' in text:
                return (now - datetime.timedelta(days=1)).date()
            elif re.search(r'^\d{2}-\d{2}$', text): # 12-21
                return datetime.datetime.strptime(f'{now.year}-{text}', '%Y-%m-%d').date()
            elif re.search(r'^\d{4}-\d{2}-\d{2}$', text): # 2024-12-21
                return datetime.datetime.strptime(text, '%Y-%m-%d').date()
        return now.date()  # Default to today if unknown

    def get_resources(self, uid, video, interval, limit, max_pages=0):
        containerid = self.get_containerid(uid)
        print(f'Fetching posts for containerid: {containerid}')
        
        page = 1
        resources = []
        finish = False
        empty_count = 0
        
        while not finish and empty_count < 3 and (max_pages == 0 or page <= max_pages):
            url = f'https://m.weibo.cn/api/container/getIndex?containerid={containerid}&page={page}'
            resp = self.request('GET', url)
            
            if not resp or resp.status_code != 200:
                print(f'Failed to fetch page {page}, stopping.')
                break
                
            try:
                data = resp.json()
                ok = data.get('ok')
                
                # Check soft-block although .request() should have handled it.
                # If we are here, it means retry failed or it's a different issue.
                if ok == -100:
                     print("Error: Access denied (Login Required).")
                     print("Trying manual cookie is recommended if auto-fetch fails.")
                     break
                     
                if ok != 1:
                    # End of feed usually returns ok=0
                    print('End of feed.')
                    break
                    
                cards = data['data']['cards']
                if not cards:
                    print(f"Page {page} is empty.")
                    empty_count += 1
                    page += 1
                    continue
                else:
                    empty_count = 0
                    
                for card in cards:
                    if int(card['card_type']) != 9:
                        continue
                        
                    mblog = card.get('mblog')
                    if not mblog: continue
                    
                    mid = str(mblog['id'])
                    date = self.parse_date(mblog.get('latest_update', mblog.get('edit_at', mblog.get('created_at', ''))))

                    # Boundary Check
                    if card['profile_type_id'] != 'proweibotop_' and ('title' not in mblog or mblog['title'] != '置顶'):
                        if limit[1] != float('inf') and date > limit[1]:
                            logger.debug(f"Boundary Check: {date} > {limit[1]}")
                            print(f"Boundary Check: {date} > {limit[1]}")
                            continue
                        if limit[0] != 0 and date < limit[0]:
                            logger.debug(f"Boundary Check: {date} < {limit[0]}")
                            print(f"Boundary Check: {date} < {limit[0]}")
                            finish = True
                            break
                        
                    mark = {'mid': mid, 'date': date, 'text': mblog.get('text', '')}
                    
                    # Photos
                    if 'pics' in mblog:
                        for idx, pic in enumerate(mblog['pics'], 1):
                            if 'large' in pic:
                                url = pic['large']['url']
                                resources.append({**mark, 'url': url, 'index': idx, 'type': 'photo'})
                    
                    # Videos
                    if video and 'page_info' in mblog:
                        page_info = mblog['page_info']
                        if page_info.get('type') == 'video':
                            media_info = page_info.get('media_info', {})
                            video_url = media_info.get('stream_url_hd') or \
                                        media_info.get('mp4_720p_mp4') or \
                                        media_info.get('mp4_hd_url') or \
                                        media_info.get('stream_url')
                            
                            if video_url:
                                resources.append({**mark, 'url': video_url, 'index': 1, 'type': 'video'})
                                
            except Exception as e:
                print(f'Error parsing page {page}: {e}')
                
            print(f'Page {page} analyzed. Total resources: {len(resources)}', end='\r')
            page += 1
            time.sleep(interval)
            
        print(f'\nFinished scanning. Total {len(resources)} items.')
        return resources


def bid_to_mid(string):
    # Only useful if user provides Base62 ID (bid) instead of numeric mid
    # Modern m.weibo.cn usually returns numeric 'id'
    alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    base = len(alphabet)
    alphabet_map = {x: n for n, x in enumerate(alphabet)}
    
    mid = 0
    for char in string:
        mid = mid * base + alphabet_map[char]
    return mid

def format_name(item, name_format):
    # Clean up URL to get filename
    url_path = urlparse(item['url']).path
    filename = os.path.basename(url_path)
    if not filename:
        filename = f"{item['mid']}_{item['index']}.jpg"
    file_root, file_ext = os.path.splitext(filename)
        
    def safeify(text):
        return re.sub(r'[\\/:*?"<>|]', '_', text)

    def substitute(matched):
        key = matched.group(1).split(':')
        k = key[0]
        v = ''
        if k == 'name':
           v = file_root
        elif k == 'date':
           v = item['date'].strftime(key[1]) if len(key) > 1 else str(item['date'])
        elif k == 'index':
           v = str(item['index']).zfill(int(key[1] if len(key) > 1 else '0'))
        elif k == 'text':
           v = re.sub(r'<.*?>', '', item['text']).strip()[:50] # Limit text length
        elif k in item:
           v = str(item[k])
        return safeify(v)

    if '{' in name_format:
        return re.sub(r'{(.*?)}', substitute, name_format) + file_ext
    
    return safeify(filename)

def download_file(url, path, overwrite):
    if os.path.exists(path) and not overwrite:
        if os.path.getsize(path) > 0:
            return True
            
    try:
        resp = requests.get(url, stream=True, timeout=20, headers=DEFAULT_HEADERS, verify=False)
        if resp.status_code != 200:
            return False
            
        with open(path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        return True
    except Exception:
        if os.path.exists(path):
            os.remove(path)
        return False

def main():
    args = parser.parse_args()
    
    # Process Users
    users = args.users if hasattr(args, 'users') and args.users else []
    
    # Process Supertopics
    topics = args.topics if hasattr(args, 'topics') and args.topics else []
    
    if args.files:
        for fpath in args.files:
            if os.path.isfile(fpath):
                with open(fpath, 'r', encoding='utf-8') as f:
                    for line in map(str.strip, f):
                        if not line: continue
                        # Check if it's a container ID
                        if line.startswith("100808"):
                            topics.append(line)
                        # Check if it's a supertopic name with suffix
                        elif line.endswith("超話") or line.endswith("超话"):
                            topics.append(line[:-2])
                        else:
                            users.append(line)

    # Target Directory
    base_dir = args.directory if args.directory else os.path.join(os.path.dirname(__file__), 'weiboPic')
    if not os.path.exists(base_dir):
        os.makedirs(base_dir)
        
    # Cookie
    cookie = None
    if args.cookie:
        if os.path.isfile(args.cookie):
            with open(args.cookie, 'r', encoding='utf-8') as f:
                # Remove all newlines and extra whitespace
                cookie = ' '.join(f.read().split())
        else:
            cookie = args.cookie
            
    # Boundary
    print(f"{args.boundary=}")
    boundary = args.boundary.split(':')
    if len(boundary) == 1: boundary = boundary * 2
    
    def parse_boundary(val):
        if not val: return None
        if val.startswith('@'):
            val = val[1:]
        try:
            if '-' in val:
                return datetime.datetime.strptime(val, '%Y-%m-%d').date()
            return datetime.datetime.strptime(val, '%Y%m%d').date()
        except ValueError:
            return None
        
    b_start = parse_boundary(boundary[0]) or datetime.date(2000, 1, 1) # Way past
    b_end = parse_boundary(boundary[1]) or datetime.date(2099, 12, 31) # Way future
    limit = (b_start, b_end)
    print(f"{limit=}")

    scraper = WeiboScraper(cookie)
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=args.size)

    # Process Supertopics
    for i, topic_input in enumerate(topics, 1):
        print(f'[{i}/{len(topics)}] Processing supertopic: {topic_input}')
        
        containerid = None
        topic_name = None
        
        # Check if input is already a container ID (starts with 100808)
        if topic_input.startswith('100808'):
            containerid = topic_input
            # Get the actual supertopic name from containerid
            topic_name = scraper.get_supertopic_name_by_id(containerid)
        else:
            # Search for supertopic by name
            containerid, topic_name = scraper.search_supertopic(topic_input)
            if not topic_name:
                topic_name = topic_input
            
        if not containerid:
            print(f'Could not find supertopic: {topic_input}')
            continue
            
        print(f'Supertopic: {topic_name} (ID: {containerid})')
        
        resources = scraper.get_supertopic_resources(containerid, args.video, args.interval, limit, args.pages)
        
        if not resources:
            print('No resources found.')
            continue
            
        # Sanitize folder name
        safe_topic_name = re.sub(r'[\\/:*?"<>|]', '_', topic_name)
        topic_dir = os.path.join(base_dir, f'topic/{safe_topic_name}')
        if not os.path.exists(topic_dir):
            os.makedirs(topic_dir)
            
        print(f'Downloading {len(resources)} items...')
        
        futures = []
        for res in resources:
            fname = format_name(res, args.name)
            fpath = os.path.join(topic_dir, fname)
            futures.append(pool.submit(download_file, res['url'], fpath, args.overwrite))
            
        done_count = 0
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            done_count += 1
            print(f'Progress: {done_count}/{len(resources)}', end='\r')
            
        print('\nDone.')

    # Process Users
    for i, user_input in enumerate(users, 1):
        print(f'[{i}/{len(users)}] Processing: {user_input}')
        
        uid = None
        nickname = None
        
        if user_input.isdigit():
            uid = user_input
            nickname = scraper.uid_to_nickname(uid)
        else:
            uid = scraper.nickname_to_uid(user_input)
            nickname = user_input
            
        if not uid:
            print(f'Could not resolve UID for {user_input}')
            continue
            
        print(f'User: {nickname} (UID: {uid})')
        
        resources = scraper.get_resources(uid, args.video, args.interval, limit, args.pages)
        
        if not resources:
            print('No resources found.')
            continue
            
        user_dir = os.path.join(base_dir, nickname)
        if not os.path.exists(user_dir):
            os.makedirs(user_dir)
            
        print(f'Downloading {len(resources)} items...')
        
        futures = []
        for res in resources:
            fname = format_name(res, args.name)
            fpath = os.path.join(user_dir, fname)
            futures.append(pool.submit(download_file, res['url'], fpath, args.overwrite))
            
        done_count = 0
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            done_count += 1
            print(f'Progress: {done_count}/{len(resources)}', end='\r')
            
        print('\nDone.')

if __name__ == '__main__':
    main()