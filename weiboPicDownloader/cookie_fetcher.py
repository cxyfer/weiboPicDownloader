# -*- coding: utf-8 -*-
"""
Cookie fetching using Selenium to bypass JS challenges.
"""

import sys
import os
import time
import traceback

from .constants import MOBILE_USER_AGENT

# Selenium imports - optional dependency
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
        if os.environ.get("HEADLESS_MODE") != "0":  # Allow debug by setting env HEADLESS_MODE=0
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
