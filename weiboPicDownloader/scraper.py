# -*- coding: utf-8 -*-
"""
Weibo scraper for fetching user posts and supertopic resources.
"""

import re
import datetime
import time
import logging
import requests

from .constants import DEFAULT_HEADERS
from .cookie_fetcher import CookieFetcher

# Disable SSL warnings
try:
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except ImportError:
    pass

logger = logging.getLogger(__name__)


class WeiboScraper:
    """Scraper for fetching Weibo posts and extracting media resources."""
    
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
        """Make HTTP request with automatic cookie refresh on auth failure."""
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
            if retry_auth:  # Simple retry for network errors
               print(f'Network error: {e}, retrying...')
               time.sleep(1)
               return self.request(method, url, allow_redirects, retry_auth=False)
            print(f'Request failed: {e}')
            return None

    def prime_cookies(self, uid):
        """Visits the user profile page to initialize visitor cookies if manual/headless failed."""
        if self.manual_cookie:
            return
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
        """Parse various date formats from Weibo API responses."""
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
            elif re.search(r'^\d{2}-\d{2}$', text):  # 12-21
                return datetime.datetime.strptime(f'{now.year}-{text}', '%Y-%m-%d').date()
            elif re.search(r'^\d{4}-\d{2}-\d{2}$', text):  # 2024-12-21
                return datetime.datetime.strptime(text, '%Y-%m-%d').date()
        return now.date()  # Default to today if unknown

    def get_resources(self, uid, video, interval, limit, max_pages=0):
        """Fetch resources from a user's posts."""
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
                    if not mblog:
                        continue
                    
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
