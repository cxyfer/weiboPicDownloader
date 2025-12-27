# -*- coding: utf-8 -*-
"""
Shared constants and default headers.
"""

# Mobile User Agent for simulating mobile browser
MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'

# Default HTTP headers for Weibo API requests
DEFAULT_HEADERS = {
    'User-Agent': MOBILE_USER_AGENT,
    'Referer': 'https://m.weibo.cn/',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'MWeibo-Pwa': '1',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
}
