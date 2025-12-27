# -*- coding: utf-8 -*-
"""
Utility functions for file naming, downloading, and ID conversion.
"""

import os
import re
import requests
from urllib.parse import urlparse

from .constants import DEFAULT_HEADERS


def bid_to_mid(string):
    """Convert Base62 ID (bid) to numeric mid."""
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
    """Format filename based on template and item metadata."""
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
           v = re.sub(r'<.*?>', '', item['text']).strip()[:50]  # Limit text length
        elif k in item:
           v = str(item[k])
        return safeify(v)

    if '{' in name_format:
        return re.sub(r'{(.*?)}', substitute, name_format) + file_ext
    
    return safeify(filename)


def download_file(url, path, overwrite):
    """Download a file from URL to local path."""
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
