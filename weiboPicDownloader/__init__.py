# -*- coding: utf-8 -*-
"""
weiboPicDownloader - Batch download Weibo user photos and videos.

This package provides tools for downloading media from Weibo users and supertopics.
"""

from .constants import DEFAULT_HEADERS, MOBILE_USER_AGENT
from .cookie_fetcher import CookieFetcher, HAS_SELENIUM
from .scraper import WeiboScraper
from .utils import bid_to_mid, format_name, download_file
from .cli import main

__version__ = '2.0.0'
__all__ = [
    'WeiboScraper',
    'CookieFetcher',
    'HAS_SELENIUM',
    'DEFAULT_HEADERS',
    'MOBILE_USER_AGENT',
    'bid_to_mid',
    'format_name',
    'download_file',
    'main',
]
