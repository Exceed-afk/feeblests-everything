// Phase 2: markdown parsing, wiki links, checklists and word counting.
//   npm test
// The HTML/sanitising steps need a DOM (DOMPurify); they are checked in the
// browser pass instead. Everything here is the pure layer that feeds them.
import assert from 'node:assert/strict'
import {
  findChecklistItems, findHashtags, findWikiLinks, linkifyWikiLinks, plainSummary,
  setChecklistItemDone, splitCodeAndText, wikiSlug, wordCount, WIKI_PROTOCOL
} from '../src/shared/markdown'

let n = 0
const test = (name: string, fn: () => void) => { fn(); n++; console.log('ok  ', name) }

test('wiki links are found, normalised and de-duplicated', () => {
  const links = findWikiLinks('See [[Meeting Notes]] and [[ meeting notes ]] and [[Ideas]].')
  assert.deepEqual(links.map((l) => l.slug), ['meeting notes', 'ideas'])
  assert.equal(links[0].title, 'Meeting Notes')
})

test('wiki link titles keep their own spelling but match case-insensitively', () => {
  assert.equal(wikiSlug('  Weekly   Review  '), 'weekly review')
  const out = linkifyWikiLinks('Read [[Weekly Review]] now')
  assert.equal(out, `Read [Weekly Review](${WIKI_PROTOCOL}weekly%20review) now`)
})

test('wiki links inside inline code and fenced blocks are left alone', () => {
  const text = 'Real [[Alpha]] and `[[Beta]]` here\n```\n[[Gamma]]\n```\nEnd [[Delta]]'
  const out = linkifyWikiLinks(text)
  assert.ok(out.includes('[Alpha](note:alpha)'))
  assert.ok(!out.includes('(note:beta)'))
  assert.ok(!out.includes('(note:gamma)'))
  assert.ok(out.includes('[Delta](note:delta)'))
  assert.ok(out.includes('`[[Beta]]`'), 'inline code keeps its brackets')
})

test('an unterminated fence is treated as code to the end (still being typed)', () => {
  const out = linkifyWikiLinks('before [[A]]\n```\n[[B]]')
  assert.ok(out.includes('(note:a)'))
  assert.ok(out.includes('[[B]]'))
})

test('splitCodeAndText round-trips the original text exactly', () => {
  const samples = [
    'plain',
    'a `code` b',
    '```\nblock\n```\nafter',
    'no closing ``` fence [[x]]',
    '`` double `` and `single`',
    ''
  ]
  for (const s of samples) {
    assert.equal(splitCodeAndText(s).map((p) => p.text).join(''), s, JSON.stringify(s))
  }
})

test('checklist items are parsed with their line numbers and state', () => {
  const md = '# Plan\n- [ ] first\n- [x] second\n  - [X] nested\n* plain bullet'
  const items = findChecklistItems(md)
  assert.deepEqual(items.map((i) => [i.text, i.done]), [['first', false], ['second', true], ['nested', true]])
})

test('checklist markers inside code are not items', () => {
  assert.equal(findChecklistItems('```\n- [ ] not a task\n```').length, 0)
})

test('setChecklistItemDone flips exactly one item, by position', () => {
  const md = '- [ ] same\n- [ ] same\n- [x] done'
  const out = setChecklistItemDone(md, 1, true)
  assert.equal(out, '- [ ] same\n- [x] same\n- [x] done')
  assert.equal(setChecklistItemDone(out, 1, false), md)
  assert.equal(setChecklistItemDone(md, 99, true), md, 'an out-of-range index changes nothing')
})

test('word count ignores markdown syntax, code and link targets', () => {
  assert.equal(wordCount('Hello world'), 2)
  assert.equal(wordCount('# Heading\n\nThe **quick** brown fox'), 5)
  assert.equal(wordCount('`code here` and [label](https://example.com/x)'), 2)
  assert.equal(wordCount('```\nignored block\n```\nkept'), 1)
  assert.equal(wordCount(''), 0)
  assert.equal(wordCount("don't split contractions"), 3)
})

test('hashtags are found in text, normalised, and skipped in code and headings', () => {
  const md = '# Not a tag\n#work and #Project/Alpha\n```\n#notatag\n```\n`#code`\nemail a#b'
  assert.deepEqual(findHashtags(md), ['work', 'project/alpha'])
})

test('plain summary strips markdown and truncates', () => {
  assert.equal(plainSummary('# Title\n\nSome **bold** text'), 'Title Some bold text')
  assert.equal(plainSummary('[[Wiki]] link'), 'Wiki link')
  const long = 'x'.repeat(300)
  const out = plainSummary(long, 40)
  assert.equal(out.length, 40)
  assert.ok(out.endsWith('…'))
})

console.log(`\n${n} markdown checks passed`)
