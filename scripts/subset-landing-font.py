"""
subset-landing-font.py — 把思源宋体（Noto Serif SC 可变字体）按宣传页（about.html + landing.js 英文词典）实际用字子集化

为什么：中文字体全量 25MB，宣传页标题只用到几百个字。按页面用字截取并固定 700 字重后约 80KB。
改了 about.html 或 public/landing.js 的文案就重跑一次，否则新出现的字会回落到系统宋体。

依赖：pip install fonttools brotli
用法：python scripts/subset-landing-font.py [字体路径]
      字体默认取 Windows 自带的 C:/Windows/Fonts/NotoSerifSC-VF.ttf
产物：public/landing/serif-sub.woff2
"""
import io
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else 'C:/Windows/Fonts/NotoSerifSC-VF.ttf'
HTML = os.path.join(ROOT, 'about.html')
LANDING_JS = os.path.join(ROOT, 'public', 'landing.js')
OUT = os.path.join(ROOT, 'public', 'landing', 'serif-sub.woff2')
# 常用 ASCII 与中文标点兜底，避免标题里临时加个符号就缺字
EXTRA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?()[]/+-×→↓“”「」，。、；：？！（）·—…'


def run(*args):
    subprocess.run([sys.executable, '-m', *args], check=True)


def main():
    html = io.open(HTML, encoding='utf-8').read()
    # 只要正文可见文字：去掉 <head>（meta / 内联样式 / JSON-LD）与 HTML 注释，否则注释里的中文会撑大子集
    html = re.sub(r'<head>[\s\S]*?</head>', ' ', html)
    html = re.sub(r'<!--[\s\S]*?-->', ' ', html)
    text = re.sub(r'<[^>]+>', ' ', html)
    # 英文词典里的字符（弯引号、破折号等）也要收进来：标题切到英文同样用宋体
    js = io.open(LANDING_JS, encoding='utf-8').read()
    en = re.search(r'var EN = \{([\s\S]*?)\};', js)
    # 只取词典里的字符串值（脚本注释里的中文不能算进来，否则子集白白变大）
    text += ' '.join(re.findall(r"'((?:[^'\\]|\\.)*)'", en.group(1) if en else ''))
    chars = ''.join(sorted({c for c in text if ord(c) > 127 or c.isprintable()} | set(EXTRA)))
    with tempfile.TemporaryDirectory() as tmp:
        chars_file = os.path.join(tmp, 'chars.txt')
        io.open(chars_file, 'w', encoding='utf-8').write(chars)
        sub = os.path.join(tmp, 'sub.ttf')
        sub700 = os.path.join(tmp, 'sub700.ttf')
        # 先截字再固定字重：对 25MB 的可变字体直接做 instancer 很慢
        run('fontTools.subset', SRC, '--text-file=' + chars_file, '--output-file=' + sub, '--layout-features=*')
        run('fontTools.varLib.instancer', sub, 'wght=700', '-o', sub700, '-q')
        run('fontTools.subset', sub700, '--text-file=' + chars_file, '--flavor=woff2',
            '--layout-features=*', '--output-file=' + OUT)
    print('%d 个字 → %s（%d KB）' % (len(chars), OUT, os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()
