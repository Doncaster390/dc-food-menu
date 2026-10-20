'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeItem, validDate } = require('../server');

function menuItem(overrides) {
  return Object.assign({
    id: 'menu-1',
    date: '2026-10-20',
    period: 'Breakfast',
    name: 'Avocado toast',
    category: 'Main dish',
    description: '',
    coworkerCost: '50p',
    contractorCost: '£1.20',
    healthy: true,
    oneDaySpecial: false,
    ingredients: [{ name: 'Avocado', coworkerCost: '50p', contractorCost: '£1', available: true }],
    photo: ''
  }, overrides || {});
}

test('validDate accepts a real ISO date only', () => {
  assert.equal(validDate('2026-10-20'), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('20-10-2026'), false);
});

test('normalizeItem trims fields and returns a canonical menu item', () => {
  const result = normalizeItem(menuItem({ name: '  Avocado toast  ' }));
  assert.equal(result.error, undefined);
  assert.equal(result.value.name, 'Avocado toast');
  assert.equal(result.value.ingredients[0].available, true);
});

test('normalizeItem leaves an omitted photo unset so updates can preserve it', () => {
  const item = menuItem();
  delete item.photo;
  const result = normalizeItem(item);
  assert.equal(result.error, undefined);
  assert.equal(Object.hasOwn(result.value, 'photo'), false);
});

test('normalizeItem rejects invalid dates, meal periods, and missing names', () => {
  assert.match(normalizeItem(menuItem({ date: '2026-02-30' })).error, /date/);
  assert.match(normalizeItem(menuItem({ period: 'Supper' })).error, /Meal/);
  assert.match(normalizeItem(menuItem({ name: '  ' })).error, /Dish name/);
});

test('normalizeItem rejects unsafe photo types and invalid ingredient entries', () => {
  assert.match(normalizeItem(menuItem({ photo: 'data:image/svg+xml;base64,PHN2Zz4=' })).error, /Photo/);
  assert.match(normalizeItem(menuItem({ ingredients: [{ name: '' }] })).error, /ingredient/i);
});
