#!/usr/bin/env python3
"""產生「點一下就把待辦加到 Google Tasks 預設清單」的連結，標題結尾附上 session 連結。

用法：python3 make_task_link.py "<標題>" "<session 連結>"
"""
import sys
import urllib.parse

# 跟 all.html／home.html 的 MULTI_API_URL 相同（主要 prayer-card Apps Script 部署）
API_URL = 'https://script.google.com/macros/s/AKfycbyaeqMjoNHYhTSMeu6uTCHipau8egCa72-SOWIARZJ-85GE82Bc0Audu62lQS8IEgxmyw/exec'


def main():
    if len(sys.argv) != 3:
        sys.exit('用法：make_task_link.py "<標題>" "<session 連結>"')
    title, session_url = sys.argv[1].strip(), sys.argv[2].strip()
    if not title or not session_url.startswith('https://claude.ai/code/session_'):
        sys.exit('標題不能空白，session 連結要是 https://claude.ai/code/session_... 格式')
    value = title + ' ' + session_url
    print(API_URL + '?' + urllib.parse.urlencode({'action': 'exportCalendarEventToTasks', 'value': value}))


if __name__ == '__main__':
    main()
