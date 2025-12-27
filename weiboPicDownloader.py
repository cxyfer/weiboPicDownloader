#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
weiboPicDownloader - Backward-compatible entry point.

For modular usage, import from the weiboPicDownloader package:
    from weiboPicDownloader import WeiboScraper, CookieFetcher

This file is maintained for backward compatibility with existing scripts.
"""

from weiboPicDownloader.cli import main

if __name__ == '__main__':
    main()