#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 的最新版本段落生成 public/update-log.json。
 *
 * standard-version 的 postchangelog 钩子和 `npm run build` 都会调用本脚本，
 * 保证更新弹窗读取到的是最近一次发版内容，而不是打包进旧页面的常量。
 *
 * 手动执行：node scripts/generate-update-log.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const OUTPUT_PATH = path.join(ROOT, 'public', 'update-log.json');

/** 面向用户展示的章节与中文前缀 */
const USER_SECTIONS = {
    features: '新增',
    'bug fixes': '修复',
    'performance improvements': '优化',
    reverts: '回退',
};

/** 没有功能/修复时，才回退展示这些内部章节 */
const FALLBACK_SECTIONS = {
    documentation: '文档',
    'code refactoring': '重构',
    styles: '样式',
    'build system': '构建',
    tests: '测试',
    ci: '持续集成',
    chore: '其他',
};

function cleanItem(raw) {
    return raw
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\*\*(.+?):\*\*\s*/, '')
        .replace(/\s+[0-9a-f]{7,40}$/i, '')
        .trim();
}

function parseLatest(changelog) {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex(
        line =>
            /^##\s+/.test(line) &&
            /[0-9]+\.[0-9]+\.[0-9]+/.test(line) &&
            /\(\d{4}-\d{2}-\d{2}\)/.test(line)
    );
    if (start === -1) throw new Error('CHANGELOG.md 中找不到版本段落');

    const end = lines.findIndex(
        (line, index) => index > start && /^##\s+/.test(line)
    );
    const sectionLines = lines.slice(start + 1, end === -1 ? undefined : end);

    const header = lines[start];
    const version = header.match(/[0-9]+\.[0-9]+\.[0-9]+(?:-[^\s\]]+)?/)?.[0];
    const date = header.match(/\(\d{4}-\d{2}-\d{2}\)/)?.[0].slice(1, -1);
    if (!version) throw new Error('CHANGELOG.md 版本号解析失败');

    const preferred = [];
    const fallback = [];
    let section = '';
    let current = null;

    for (const line of sectionLines) {
        const heading = line.match(/^###\s+(.+?)\s*$/);
        if (heading) {
            section = heading[1].trim().toLowerCase();
            current = null;
            continue;
        }

        const bullet = line.match(/^\*\s+(.+?)\s*$/);
        if (bullet) {
            current = { section, text: cleanItem(bullet[1]) };
            if (USER_SECTIONS[section]) preferred.push(current);
            else if (FALLBACK_SECTIONS[section]) fallback.push(current);
            continue;
        }

        // 处理被换行折断的条目
        if (current && /^\s{2,}\S/.test(line)) {
            current.text = `${current.text} ${line.trim()}`.trim();
            continue;
        }

        if (line.trim() === '') current = null;
    }

    const source = preferred.length ? preferred : fallback;
    const items = [];
    for (const entry of source) {
        if (!entry.text || items.includes(entry.text)) continue;
        const label = USER_SECTIONS[entry.section] || FALLBACK_SECTIONS[entry.section];
        items.push(
            label && !entry.text.startsWith(label)
                ? `${label}：${entry.text}`
                : entry.text
        );
    }

    return {
        version,
        date: date || '',
        items: items.length ? items : ['本次更新包含若干优化与修复。'],
    };
}

function main() {
    const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const updateLog = parseLatest(changelog);
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(
        OUTPUT_PATH,
        JSON.stringify(updateLog, null, 4) + '\n',
        'utf8'
    );
    console.log(
        `[update-log] v${updateLog.version}: ${updateLog.items.length} 条 -> ${path.relative(
            ROOT,
            OUTPUT_PATH
        )}`
    );
}

try {
    main();
} catch (error) {
    console.error('[update-log] 生成失败：', error.message);
    process.exit(1);
}
