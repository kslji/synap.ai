import assert from 'node:assert/strict'
import test from 'node:test'
import { compareFromText, countFromText, verbatimAnswer } from './number-tools.js'

test('9.9 is larger than 9.11 because 9.9 is 9.90', () => {
  const hit = compareFromText('Which is larger, 9.11 or 9.9? Reply with the larger number and the word larger.')
  assert.ok(hit)
  assert.equal(hit.answer, '9.9 is larger.')
  assert.equal(verbatimAnswer('9.11 is larger than 9.9.', [{ name: 'compare_numbers', output: hit.output }]), '9.9 is larger.')
})

test('smaller and ordering use numeric order', () => {
  assert.equal(compareFromText('Which is smaller, 9.11 or 9.9?')?.answer, '9.11 is smaller.')
  assert.equal(compareFromText('Order these numbers from smallest to largest: 10, 2, 9.11')?.answer, 'Ascending: 2, 9.11, 10.')
  assert.equal(compareFromText('What is the maximum of 3 and 10?')?.answer, '10 is larger.')
})

test('a-b-c-d has 3 hyphens', () => {
  const hit = countFromText('How many hyphen characters are in this text: a-b-c-d? Reply with the number of hyphens.')
  assert.equal(hit?.answer, '3')
  assert.equal(verbatimAnswer('The text contains 2 hyphens.', [{ name: 'text_count', output: '3' }]), '3')
})

test('words, characters, and occurrences', () => {
  assert.equal(countFromText('How many words are in this text: one two three')?.answer, '3')
  assert.equal(countFromText('How many characters are in this text: "ना"')?.answer, '2')
  assert.equal(countFromText('How many times does "cat" appear in "cat cat dog"')?.answer, '2')
})

test('a document question is not a number tool', () => {
  assert.equal(compareFromText('When does the harbor ferry leave Pier 4?'), null)
  assert.equal(countFromText('What is the pier locker combination?'), null)
})
