# -*- coding: utf-8 -*-
"""
Command-line interface for weiboPicDownloader.
"""

import os
import re
import datetime
import argparse
import concurrent.futures

from .scraper import WeiboScraper
from .utils import format_name, download_file


# Argument parser setup
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


def main():
    """Main entry point for the CLI."""
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
                        if not line:
                            continue
                        # Check if it's a container ID
                        if line.startswith("100808"):
                            topics.append(line)
                        # Check if it's a supertopic name with suffix
                        elif line.endswith("超話") or line.endswith("超话"):
                            topics.append(line[:-2])
                        else:
                            users.append(line)

    # Target Directory
    base_dir = args.directory if args.directory else os.path.join(os.path.dirname(__file__), '..', 'weiboPic')
    base_dir = os.path.abspath(base_dir)
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
    if len(boundary) == 1:
        boundary = boundary * 2
    
    def parse_boundary(val):
        if not val:
            return None
        if val.startswith('@'):
            val = val[1:]
        try:
            if '-' in val:
                return datetime.datetime.strptime(val, '%Y-%m-%d').date()
            return datetime.datetime.strptime(val, '%Y%m%d').date()
        except ValueError:
            return None
        
    b_start = parse_boundary(boundary[0]) or datetime.date(2000, 1, 1)  # Way past
    b_end = parse_boundary(boundary[1]) or datetime.date(2099, 12, 31)  # Way future
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
