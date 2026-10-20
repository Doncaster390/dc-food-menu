(function () {
  'use strict';

  var MAX_PHOTO_SIZE = 2 * 1024 * 1024;
  var MAX_CSV_SIZE = 2 * 1024 * 1024;
  var EDITOR_TOKEN_KEY = 'dc-food-menu-editor-token';
  var selectedDate = new Date();
  selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  var monthCursor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  var rotationDates = [];
  var editingId = '';
  var itemFormDirty = false;
  var photoData = '';
  var csvRows = null;
  var noticeTimer;
  var loadSequence = 0;
  var currentRange = '';
  var editorToken = sessionStorage.getItem(EDITOR_TOKEN_KEY) || '';
  var state = { items: [], loadError: false };

  var el = {
    notice: document.getElementById('notice'),
    calendarDays: document.getElementById('calendarDays'),
    monthLabel: document.getElementById('monthLabel'),
    selectedDateLabel: document.getElementById('selectedDateLabel'),
    dailyNote: document.getElementById('dailyNote'),
    dailyNoteText: document.getElementById('dailyNoteText'),
    breakfastItems: document.getElementById('breakfastItems'),
    lunchItems: document.getElementById('lunchItems'),
    breakfastEmpty: document.getElementById('breakfastEmpty'),
    lunchEmpty: document.getElementById('lunchEmpty'),
    servingBadge: document.getElementById('servingBadge'),
    itemForm: document.getElementById('itemForm'),
    itemDialogTitle: document.getElementById('itemDialogTitle'),
    formDateContext: document.getElementById('formDateContext'),
    addMenuSection: document.getElementById('addMenuSection'),
    itemPeriod: document.getElementById('itemPeriod'),
    itemName: document.getElementById('itemName'),
    itemCategory: document.getElementById('itemCategory'),
    itemDescription: document.getElementById('itemDescription'),
    coworkerCost: document.getElementById('coworkerCost'),
    contractorCost: document.getElementById('contractorCost'),
    healthyOption: document.getElementById('healthyOption'),
    oneDaySpecial: document.getElementById('oneDaySpecial'),
    rotationDate: document.getElementById('rotationDate'),
    dateChips: document.getElementById('dateChips'),
    ingredientRows: document.getElementById('ingredientRows'),
    itemPhoto: document.getElementById('itemPhoto'),
    photoPreview: document.getElementById('photoPreview'),
    deleteItemButton: document.getElementById('deleteItemButton'),
    cancelEditButton: document.getElementById('cancelEditButton'),
    saveItemButton: document.getElementById('saveItemButton'),
    calendarApp: document.getElementById('calendarApp'),
    menuView: document.getElementById('menuView'),
    menuViewTitle: document.getElementById('menuViewTitle'),
    menuViewDate: document.getElementById('menuViewDate'),
    uploadDialog: document.getElementById('uploadDialog'),
    uploadForm: document.getElementById('uploadForm'),
    bulkFile: document.getElementById('bulkFile'),
    uploadFileLabel: document.getElementById('uploadFileLabel'),
    uploadPreview: document.getElementById('uploadPreview'),
    importButton: document.getElementById('importButton'),
    editorLoginButton: document.getElementById('editorLoginButton'),
    editorLogoutButton: document.getElementById('editorLogoutButton'),
    editorDialog: document.getElementById('editorDialog'),
    editorForm: document.getElementById('editorForm'),
    editorPin: document.getElementById('editorPin'),
    editorLoginSubmit: document.getElementById('editorLoginSubmit'),
    saveStatusText: document.getElementById('saveStatusText')
  };

  function showNotice(message) {
    el.notice.textContent = message;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(function () { el.notice.textContent = ''; }, 4500);
  }

  async function apiRequest(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.editor && editorToken) headers.Authorization = 'Bearer ' + editorToken;
    var response = await fetch(path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    var data = null;
    try {
      data = await response.json();
    } catch (error) {
      if (response.status !== 204) throw new Error('The menu service returned an unreadable response.');
    }
    if (!response.ok) {
      if (response.status === 401 && options.editor) clearEditorSession();
      var failure = new Error(data && data.error ? data.error : 'Menu request failed (' + response.status + ').');
      failure.status = response.status;
      throw failure;
    }
    return data;
  }

  function setEditorSession(token) {
    editorToken = token;
    sessionStorage.setItem(EDITOR_TOKEN_KEY, token);
    el.editorLoginButton.hidden = true;
    el.editorLogoutButton.hidden = false;
  }

  function clearEditorSession() {
    editorToken = '';
    sessionStorage.removeItem(EDITOR_TOKEN_KEY);
    el.editorLoginButton.hidden = false;
    el.editorLogoutButton.hidden = true;
  }

  if (editorToken) {
    el.editorLoginButton.hidden = true;
    el.editorLogoutButton.hidden = false;
  }

  function dateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function parseDateKey(key) {
    var parts = key.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isSameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  function calendarRange() {
    var first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    var start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    var end = new Date(start);
    end.setDate(start.getDate() + 42);
    return { from: dateKey(start), to: dateKey(end) };
  }

  async function loadMenuRange(force) {
    var range = calendarRange();
    var rangeKey = range.from + ':' + range.to;
    if (!force && currentRange === rangeKey) return;
    var requestId = ++loadSequence;
    el.saveStatusText.textContent = 'Loading shared menu';
    try {
      var data = await apiRequest('/api/menu-items?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to));
      if (!data || !Array.isArray(data.items)) throw new Error('The menu service returned invalid menu data.');
      if (requestId !== loadSequence) return;
      state.items = data.items;
      state.loadError = false;
      currentRange = rangeKey;
      el.saveStatusText.textContent = 'Shared menu';
      renderAll();
    } catch (error) {
      if (requestId !== loadSequence) return;
      state.items = [];
      state.loadError = true;
      el.saveStatusText.textContent = 'Menu unavailable';
      renderAll();
      showNotice(error.message || 'Could not load the shared menu. Please try again.');
    }
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatLongDate(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
  }

  function visibleItemsForDate(date) {
    var today = dateKey(new Date());
    var key = dateKey(date);
    return state.items.filter(function (item) {
      return item.date === key && !(item.oneDaySpecial && item.date < today);
    });
  }

  function renderCalendar() {
    el.monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthCursor);
    el.calendarDays.replaceChildren();
    var gridStart = parseDateKey(calendarRange().from);
    var today = new Date();

    for (var index = 0; index < 42; index += 1) {
      var date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      var key = dateKey(date);
      var button = element('button', 'calendar-day');
      button.type = 'button';
      button.textContent = String(date.getDate());
      button.dataset.date = key;
      button.setAttribute('aria-label', formatLongDate(date) + (state.items.some(function (item) { return item.date === key; }) ? ', menu planned' : ''));
      if (date.getMonth() !== monthCursor.getMonth()) button.classList.add('is-outside');
      if (isSameDay(date, selectedDate)) button.classList.add('is-selected');
      if (isSameDay(date, today)) button.classList.add('is-today');
      if (state.items.some(function (item) { return item.date === key; })) button.classList.add('has-menu');
      el.calendarDays.appendChild(button);
    }
  }

  function createCostLine(item) {
    var costs = element('div', 'item-costs');
    if (item.coworkerCost) {
      var coworker = element('span');
      coworker.append(element('strong', '', item.coworkerCost), document.createTextNode(' co-worker'));
      costs.appendChild(coworker);
    }
    if (item.contractorCost) {
      var contractor = element('span');
      contractor.append(element('strong', '', item.contractorCost), document.createTextNode(' contractor'));
      costs.appendChild(contractor);
    }
    return costs;
  }

  function renderMenuItem(item) {
    var card = element('article', 'menu-item');
    var image;
    var photoUrl = item.photoUrl || item.photo;
    if (photoUrl) {
      image = element('img', 'item-photo');
      image.src = photoUrl;
      image.alt = '';
    } else {
      image = element('div', 'item-icon', item.period === 'Breakfast' ? '☕' : '✳');
      image.setAttribute('aria-hidden', 'true');
    }

    var content = element('div', 'item-content');
    var topLine = element('div', 'item-topline');
    var titleGroup = element('div');
    titleGroup.appendChild(element('h3', 'item-name', item.name));
    titleGroup.appendChild(element('span', 'item-category', item.category || 'Main dish'));
    var actions = element('div', 'item-actions');
    var edit = element('button', 'item-action', '✎');
    edit.type = 'button';
    edit.dataset.editItem = item.id;
    edit.setAttribute('aria-label', 'Edit ' + item.name);
    var remove = element('button', 'item-action delete', '▤');
    remove.type = 'button';
    remove.dataset.deleteItem = item.id;
    remove.setAttribute('aria-label', 'Delete ' + item.name);
    actions.append(edit, remove);
    topLine.append(titleGroup, actions);
    content.appendChild(topLine);
    if (item.description) content.appendChild(element('p', 'item-description', item.description));
    if (item.coworkerCost || item.contractorCost) content.appendChild(createCostLine(item));

    var ingredients = Array.isArray(item.ingredients) ? item.ingredients : [];
    if (ingredients.length) {
      var list = element('ul', 'ingredient-list');
      ingredients.forEach(function (ingredient, index) {
        var row = element('li', 'ingredient-row');
        var name = element('span', 'ingredient-name', ingredient.name);
        var prices = [];
        if (ingredient.coworkerCost) prices.push(ingredient.coworkerCost);
        if (ingredient.contractorCost) prices.push(ingredient.contractorCost);
        if (prices.length) row.appendChild(element('span', 'ingredient-price', prices.join(' / ')));
        var available = document.createElement('input');
        available.type = 'checkbox';
        available.className = 'ingredient-available';
        available.checked = ingredient.available !== false;
        available.dataset.itemId = item.id;
        available.dataset.ingredientIndex = String(index);
        available.setAttribute('aria-label', ingredient.name + ' available');
        row.append(name, available);
        list.appendChild(row);
      });
      content.appendChild(list);
    }

    if (item.healthy || item.oneDaySpecial) {
      var flags = element('div', 'item-flags');
      if (item.healthy) flags.appendChild(element('span', 'item-tag', 'Healthy option'));
      if (item.oneDaySpecial) flags.appendChild(element('span', 'item-tag special', 'One-day special'));
      content.appendChild(flags);
    }
    card.append(image, content);
    return card;
  }

  function renderPublicItems(container, empty, items) {
    container.replaceChildren();
    empty.hidden = items.length > 0;
    items.forEach(function (item) {
      var row = element('article', 'public-item');
      var info = element('div');
      info.appendChild(element('h3', '', item.name));
      if (item.description) info.appendChild(element('p', '', item.description));
      var price = [item.coworkerCost, item.contractorCost].filter(Boolean).join(' / ');
      row.append(info);
      if (price) row.appendChild(element('span', 'public-item-cost', price));
      container.appendChild(row);
    });
  }

  function renderSelectedDate() {
    var key = dateKey(selectedDate);
    var today = isSameDay(selectedDate, new Date());
    var dateText = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(selectedDate);
    el.selectedDateLabel.textContent = today ? 'Today · ' + dateText : formatLongDate(selectedDate);
    var items = visibleItemsForDate(selectedDate);
    var breakfast = items.filter(function (item) { return item.period === 'Breakfast'; });
    var lunch = items.filter(function (item) { return item.period !== 'Breakfast'; });
    el.breakfastItems.replaceChildren();
    el.lunchItems.replaceChildren();
    breakfast.forEach(function (item) { el.breakfastItems.appendChild(renderMenuItem(item)); });
    lunch.forEach(function (item) { el.lunchItems.appendChild(renderMenuItem(item)); });
    el.breakfastEmpty.hidden = breakfast.length > 0;
    el.lunchEmpty.hidden = lunch.length > 0;
    el.dailyNote.classList.toggle('has-menu', items.length > 0);
    if (state.loadError) {
      el.dailyNoteText.textContent = 'Could not load this day’s menu. Check your connection and try again.';
      el.breakfastEmpty.textContent = 'Menu data is temporarily unavailable.';
      el.lunchEmpty.textContent = 'Menu data is temporarily unavailable.';
    } else {
      el.dailyNoteText.textContent = items.length ? items.length + (items.length === 1 ? ' menu item planned for this day.' : ' menu items planned for this day.') : 'No menu set for this day.';
      el.breakfastEmpty.textContent = 'A fresh start begins with something good.';
      el.lunchEmpty.textContent = 'No menu added yet.';
    }
    var now = new Date();
    var servingNow = today && now.getHours() >= 11 && now.getHours() < 22 && lunch.length > 0;
    el.servingBadge.hidden = !servingNow;

    renderPublicItems(document.getElementById('publicBreakfastItems'), document.getElementById('publicBreakfastEmpty'), breakfast);
    renderPublicItems(document.getElementById('publicLunchItems'), document.getElementById('publicLunchEmpty'), lunch);
    el.menuViewTitle.textContent = today ? "Today's menu" : 'Menu for ' + new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(selectedDate);
    el.menuViewDate.textContent = formatLongDate(selectedDate);
    renderCalendar();
    if (window.location.hash === '#menu') {
      el.calendarApp.hidden = true;
      el.menuView.hidden = false;
    }
  }

  function renderAll() {
    renderCalendar();
    renderSelectedDate();
  }

  function syncNewItemDate() {
    if (editingId || itemFormDirty) return;
    rotationDates = [dateKey(selectedDate)];
    el.formDateContext.textContent = formatLongDate(selectedDate);
    renderDateChips();
  }

  function resetItemForm(period) {
    editingId = '';
    itemFormDirty = false;
    el.itemForm.reset();
    el.itemDialogTitle.textContent = 'Add menu item';
    el.saveItemButton.textContent = 'Add to calendar';
    el.deleteItemButton.hidden = true;
    el.cancelEditButton.hidden = true;
    rotationDates = [dateKey(selectedDate)];
    el.formDateContext.textContent = formatLongDate(selectedDate);
    renderDateChips();
    el.rotationDate.value = '';
    el.ingredientRows.replaceChildren();
    photoData = '';
    previewPhoto('');
    setPeriod(period || 'Breakfast');
  }

  function addIngredientRow(ingredient) {
    var row = element('div', 'ingredient-fields');
    var name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.placeholder = 'Item name';
    name.value = ingredient ? ingredient.name : '';
    name.setAttribute('aria-label', 'Ingredient name');
    var coworker = document.createElement('input');
    coworker.type = 'text';
    coworker.maxLength = 30;
    coworker.placeholder = '50p';
    coworker.value = ingredient ? ingredient.coworkerCost || '' : '';
    coworker.setAttribute('aria-label', 'Ingredient co-worker cost');
    var contractor = document.createElement('input');
    contractor.type = 'text';
    contractor.maxLength = 30;
    contractor.placeholder = '£1';
    contractor.value = ingredient ? ingredient.contractorCost || '' : '';
    contractor.setAttribute('aria-label', 'Ingredient contractor cost');
    var remove = element('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ingredient');
    remove.addEventListener('click', function () { row.remove(); });
    row.append(name, coworker, contractor, remove);
    el.ingredientRows.appendChild(row);
  }

  function renderDateChips() {
    el.dateChips.replaceChildren();
    rotationDates.forEach(function (key) {
      var chip = element('span', 'date-chip', formatLongDate(parseDateKey(key)));
      var remove = element('button', '', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + key);
      remove.addEventListener('click', function () {
        rotationDates = rotationDates.filter(function (date) { return date !== key; });
        renderDateChips();
      });
      chip.appendChild(remove);
      el.dateChips.appendChild(chip);
    });
  }

  function setPeriod(period) {
    el.itemPeriod.value = period;
    document.querySelectorAll('[data-select-period]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.selectPeriod === period);
    });
  }

  function previewPhoto(data) {
    el.photoPreview.replaceChildren();
    el.photoPreview.hidden = !data;
    if (!data) return;
    var image = element('img');
    image.src = data;
    image.alt = 'Menu item photo preview';
    el.photoPreview.appendChild(image);
  }

  function openItemDialog(period, item) {
    if (!editorToken) {
      el.editorDialog.showModal();
      el.editorPin.focus();
      return;
    }
    resetItemForm(item ? item.period : period);
    editingId = item ? item.id : '';
    el.itemDialogTitle.textContent = item ? 'Edit menu item' : 'Add menu item';
    el.saveItemButton.textContent = item ? 'Save changes' : 'Add to calendar';
    el.deleteItemButton.hidden = !item;
    el.cancelEditButton.hidden = !item;
    rotationDates = item ? [item.date] : [dateKey(selectedDate)];
    renderDateChips();
    el.formDateContext.textContent = item ? formatLongDate(parseDateKey(item.date)) : formatLongDate(selectedDate);
    el.rotationDate.value = '';
    setPeriod(item ? item.period : (period || 'Breakfast'));
    el.itemName.value = item ? item.name : '';
    el.itemCategory.value = item ? item.category || 'Main dish' : 'Main dish';
    el.itemDescription.value = item ? item.description || '' : '';
    el.coworkerCost.value = item ? item.coworkerCost || '' : '';
    el.contractorCost.value = item ? item.contractorCost || '' : '';
    el.healthyOption.checked = Boolean(item && item.healthy);
    el.oneDaySpecial.checked = Boolean(item && item.oneDaySpecial);
    el.ingredientRows.replaceChildren();
    (item && Array.isArray(item.ingredients) ? item.ingredients : []).forEach(addIngredientRow);
    photoData = item ? item.photo || '' : '';
    el.itemPhoto.value = '';
    previewPhoto(item && item.photoUrl ? item.photoUrl : photoData);
    el.addMenuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (item) el.itemName.focus({ preventScroll: true });
  }

  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        resolve(photoData);
        return;
      }
      if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type)) {
        reject(new Error('Choose a JPEG, PNG, WebP, or GIF image.'));
        return;
      }
      if (file.size > MAX_PHOTO_SIZE) {
        reject(new Error('Photos must be 2 MB or smaller.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('The photo could not be read.')); };
      reader.readAsDataURL(file);
    });
  }

  function collectIngredients() {
    var rows = Array.from(el.ingredientRows.querySelectorAll('.ingredient-fields'));
    return rows.map(function (row) {
      var inputs = row.querySelectorAll('input');
      return {
        name: inputs[0].value.trim(),
        coworkerCost: inputs[1].value.trim(),
        contractorCost: inputs[2].value.trim(),
        available: true
      };
    }).filter(function (ingredient) { return Boolean(ingredient.name); });
  }

  async function saveMenuItem(photo) {
    var wasEditing = Boolean(editingId);
    var dates = rotationDates.slice();
    if (!editorToken) {
      showNotice('Sign in as an editor before changing the shared menu.');
      el.editorDialog.showModal();
      el.editorPin.focus();
      return false;
    }
    if (!dates.length) {
      showNotice('Add at least one menu date.');
      return false;
    }
    var base = {
      name: el.itemName.value.trim(),
      period: el.itemPeriod.value,
      category: el.itemCategory.value,
      description: el.itemDescription.value.trim(),
      coworkerCost: el.coworkerCost.value.trim(),
      contractorCost: el.contractorCost.value.trim(),
      healthy: el.healthyOption.checked,
      oneDaySpecial: el.oneDaySpecial.checked,
      ingredients: collectIngredients()
    };
    if (photo) base.photo = photo;
    if (!base.name) return false;

    el.saveItemButton.disabled = true;
    try {
      if (editingId) {
        var item = state.items.find(function (entry) { return entry.id === editingId; });
        if (!item) throw new Error('That menu item could not be found. Refresh the menu and try again.');
        await apiRequest('/api/menu-items/' + encodeURIComponent(editingId), {
          method: 'PUT',
          editor: true,
          body: Object.assign({ id: editingId, date: dates[0] }, base)
        });
      } else {
        var items = dates.map(function (date) {
          return Object.assign({ id: makeId(), date: date }, base, {
            ingredients: base.ingredients.map(function (ingredient) { return Object.assign({}, ingredient); })
          });
        });
        await apiRequest('/api/menu-items/bulk', { method: 'POST', editor: true, body: { items: items } });
      }
      currentRange = '';
      resetItemForm(base.period);
      await loadMenuRange(true);
      showNotice(wasEditing ? 'Menu item updated.' : (dates.length === 1 ? 'Added to the shared menu.' : 'Added to ' + dates.length + ' rotation dates.'));
      return true;
    } catch (error) {
      showNotice(error.message || 'Could not save the menu item.');
      return false;
    } finally {
      el.saveItemButton.disabled = false;
    }
  }

  function makeId() {
    return 'menu-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var index = 0; index < text.length; index += 1) {
      var char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"' && cell.length === 0) {
        quoted = true;
      } else if (char === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    if (quoted) throw new Error('The CSV contains an unclosed quote.');
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }

  function normalizeHeader(header) {
    return header.trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function parseImportRows(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Add a header row and at least one menu item.');
    var headers = rows[0].map(normalizeHeader);
    var dateIndex = headers.indexOf('date');
    var mealIndex = headers.indexOf('meal');
    var nameIndex = headers.indexOf('name');
    if (dateIndex < 0 || mealIndex < 0 || nameIndex < 0) {
      throw new Error('Your CSV needs date, meal, and name columns.');
    }
    if (rows.length > 501) throw new Error('Upload no more than 500 menu items at a time.');

    var optionalIndexes = {
      category: headers.indexOf('category'),
      description: headers.indexOf('description'),
      coworkerCost: headers.indexOf('coworkercost'),
      contractorCost: headers.indexOf('contractorcost'),
      healthy: headers.indexOf('healthy'),
      oneDaySpecial: headers.indexOf('onedayspecial')
    };
    var result = [];
    rows.slice(1).forEach(function (columns, rowIndex) {
      var date = columns[dateIndex] || '';
      var periodInput = (columns[mealIndex] || '').toLowerCase().trim();
      var name = columns[nameIndex] || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name.trim()) {
        throw new Error('Row ' + (rowIndex + 2) + ' needs a YYYY-MM-DD date and a dish name.');
      }
      var parsedDate = parseDateKey(date);
      if (dateKey(parsedDate) !== date) throw new Error('Row ' + (rowIndex + 2) + ' has an invalid date.');
      var period;
      if (periodInput === 'breakfast') period = 'Breakfast';
      else if (periodInput === 'lunch' || periodInput === 'dinner' || periodInput === 'lunch & dinner' || periodInput === 'lunch and dinner') period = 'Lunch & Dinner';
      else throw new Error('Row ' + (rowIndex + 2) + ' meal must be Breakfast, Lunch, or Dinner.');
      function value(field) {
        var fieldIndex = optionalIndexes[field];
        return fieldIndex < 0 ? '' : (columns[fieldIndex] || '');
      }
      var healthy = value('healthy').toLowerCase();
      var special = value('oneDaySpecial').toLowerCase();
      result.push({
        id: makeId(),
        date: date,
        period: period,
        name: name.trim(),
        category: value('category').trim() || 'Main dish',
        description: value('description').trim(),
        coworkerCost: value('coworkerCost').trim(),
        contractorCost: value('contractorCost').trim(),
        healthy: ['true', 'yes', '1'].indexOf(healthy) >= 0,
        oneDaySpecial: ['true', 'yes', '1'].indexOf(special) >= 0,
        ingredients: [],
        photo: ''
      });
    });
    return result;
  }

  function setUploadMessage(message, isError) {
    el.uploadPreview.hidden = false;
    el.uploadPreview.classList.toggle('error', Boolean(isError));
    el.uploadPreview.textContent = message;
  }

  function closeDialogs(event) {
    var closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) closeButton.closest('dialog').close();
    if (event.target.tagName === 'DIALOG' && event.target === event.currentTarget) event.target.close();
  }

  document.getElementById('previousMonth').addEventListener('click', function () {
    monthCursor.setMonth(monthCursor.getMonth() - 1);
    renderCalendar();
    loadMenuRange(false);
  });
  document.getElementById('nextMonth').addEventListener('click', function () {
    monthCursor.setMonth(monthCursor.getMonth() + 1);
    renderCalendar();
    loadMenuRange(false);
  });
  document.getElementById('todayButton').addEventListener('click', function () {
    selectedDate = new Date();
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    monthCursor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    renderSelectedDate();
    syncNewItemDate();
    loadMenuRange(false);
  });
  el.calendarDays.addEventListener('click', function (event) {
    var day = event.target.closest('[data-date]');
    if (!day) return;
    selectedDate = parseDateKey(day.dataset.date);
    monthCursor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    renderSelectedDate();
    syncNewItemDate();
    loadMenuRange(false);
  });
  document.querySelectorAll('[data-add-period]').forEach(function (button) {
    button.addEventListener('click', function () { openItemDialog(button.dataset.addPeriod); });
  });
  document.getElementById('addRotationDate').addEventListener('click', function () {
    var value = el.rotationDate.value;
    if (!value) {
      showNotice('Choose a date to add to the rotation.');
      return;
    }
    if (rotationDates.indexOf(value) === -1) rotationDates.push(value);
    rotationDates.sort();
    el.rotationDate.value = '';
    renderDateChips();
  });
  document.querySelectorAll('[data-select-period]').forEach(function (button) {
    button.addEventListener('click', function () { setPeriod(button.dataset.selectPeriod); });
  });
  document.getElementById('addIngredient').addEventListener('click', function () { addIngredientRow(); });
  el.itemForm.addEventListener('input', function () { itemFormDirty = true; });
  el.itemForm.addEventListener('change', function () { itemFormDirty = true; });

  document.querySelector('.period-grid').addEventListener('click', function (event) {
    var edit = event.target.closest('[data-edit-item]');
    var remove = event.target.closest('[data-delete-item]');
    if (edit) {
      var item = state.items.find(function (entry) { return entry.id === edit.dataset.editItem; });
      if (item) openItemDialog(item.period, item);
    }
    if (remove) {
      var target = state.items.find(function (entry) { return entry.id === remove.dataset.deleteItem; });
      if (!target || !window.confirm('Delete "' + target.name + '" from the menu?')) return;
      if (!editorToken) {
        el.editorDialog.showModal();
        el.editorPin.focus();
        return;
      }
      apiRequest('/api/menu-items/' + encodeURIComponent(target.id), { method: 'DELETE', editor: true }).then(function () {
        currentRange = '';
        return loadMenuRange(true);
      }).then(function () {
        showNotice('Menu item deleted.');
      }).catch(function (error) {
        showNotice(error.message || 'Could not delete the menu item.');
      });
    }
  });
  document.querySelector('.period-grid').addEventListener('change', function (event) {
    var checkbox = event.target.closest('[data-ingredient-index]');
    if (!checkbox) return;
    var item = state.items.find(function (entry) { return entry.id === checkbox.dataset.itemId; });
    var ingredient = item && item.ingredients[Number(checkbox.dataset.ingredientIndex)];
    if (!ingredient) return;
    if (!editorToken) {
      checkbox.checked = ingredient.available !== false;
      el.editorDialog.showModal();
      el.editorPin.focus();
      return;
    }
    var previousValue = ingredient.available !== false;
    ingredient.available = checkbox.checked;
    apiRequest('/api/menu-items/' + encodeURIComponent(item.id), {
      method: 'PUT',
      editor: true,
      body: item
    }).catch(function (error) {
      ingredient.available = previousValue;
      checkbox.checked = previousValue;
      showNotice(error.message || 'Could not update ingredient availability.');
    });
  });

  el.itemPhoto.addEventListener('change', function () {
    var file = el.itemPhoto.files[0];
    if (!file) return;
    if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type) || file.size > MAX_PHOTO_SIZE) {
      el.itemPhoto.value = '';
      showNotice(file.size > MAX_PHOTO_SIZE ? 'Photos must be 2 MB or smaller.' : 'Choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    readPhoto(file).then(function (data) {
      photoData = data;
      previewPhoto(data);
    }).catch(function (error) { showNotice(error.message); });
  });
  el.itemForm.addEventListener('submit', function (event) {
    event.preventDefault();
    readPhoto(el.itemPhoto.files[0]).then(saveMenuItem).catch(function (error) { showNotice(error.message); });
  });
  el.deleteItemButton.addEventListener('click', function () {
    var item = state.items.find(function (entry) { return entry.id === editingId; });
    if (!item || !window.confirm('Delete "' + item.name + '" from the menu?')) return;
    apiRequest('/api/menu-items/' + encodeURIComponent(editingId), { method: 'DELETE', editor: true }).then(function () {
      resetItemForm();
      currentRange = '';
      return loadMenuRange(true);
    }).then(function () {
      showNotice('Menu item deleted.');
    }).catch(function (error) {
      showNotice(error.message || 'Could not delete the menu item.');
    });
  });
  el.cancelEditButton.addEventListener('click', function () {
    resetItemForm();
    el.addMenuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('bulkUploadButton').addEventListener('click', function () {
    el.uploadForm.reset();
    el.uploadFileLabel.textContent = 'Choose a CSV file';
    el.uploadPreview.hidden = true;
    el.uploadPreview.textContent = '';
    el.uploadPreview.classList.remove('error');
    csvRows = null;
    el.importButton.disabled = true;
    el.uploadDialog.showModal();
  });
  el.bulkFile.addEventListener('change', function () {
    var file = el.bulkFile.files[0];
    csvRows = null;
    el.importButton.disabled = true;
    if (!file) return;
    el.uploadFileLabel.textContent = file.name;
    if (file.size > MAX_CSV_SIZE) {
      setUploadMessage('CSV files must be 2 MB or smaller.', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        csvRows = parseImportRows(String(reader.result));
        setUploadMessage(csvRows.length + (csvRows.length === 1 ? ' menu item ready to import.' : ' menu items ready to import.'), false);
        el.importButton.disabled = false;
      } catch (error) {
        setUploadMessage(error.message, true);
      }
    };
    reader.onerror = function () { setUploadMessage('The CSV file could not be read.', true); };
    reader.readAsText(file);
  });
  el.uploadForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!csvRows || !csvRows.length) return;
    if (!editorToken) {
      showNotice('Sign in as an editor before importing menu items.');
      el.editorDialog.showModal();
      el.editorPin.focus();
      return;
    }
    var count = csvRows.length;
    el.importButton.disabled = true;
    try {
      await apiRequest('/api/menu-items/bulk', { method: 'POST', editor: true, body: { items: csvRows } });
      csvRows = null;
      el.uploadDialog.close();
      currentRange = '';
      await loadMenuRange(true);
      showNotice(count + (count === 1 ? ' menu item imported.' : ' menu items imported.'));
    } catch (error) {
      showNotice(error.message || 'Could not import menu items.');
      el.importButton.disabled = false;
    }
  });

  el.editorLoginButton.addEventListener('click', function () {
    el.editorForm.reset();
    el.editorDialog.showModal();
    el.editorPin.focus();
  });
  el.editorLogoutButton.addEventListener('click', function () {
    clearEditorSession();
    showNotice('Signed out. The shared menu remains available to view.');
  });
  el.editorForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    el.editorLoginSubmit.disabled = true;
    try {
      var result = await apiRequest('/api/admin/login', {
        method: 'POST',
        body: { pin: el.editorPin.value }
      });
      if (!result || typeof result.token !== 'string') throw new Error('The server returned an invalid sign-in response.');
      setEditorSession(result.token);
      el.editorDialog.close();
      el.editorPin.value = '';
      showNotice('Signed in. You can now manage the shared menu.');
    } catch (error) {
      showNotice(error.message || 'Could not sign in as an editor.');
    } finally {
      el.editorLoginSubmit.disabled = false;
    }
  });

  document.getElementById('viewMenuButton').addEventListener('click', function () {
    el.calendarApp.hidden = true;
    el.menuView.hidden = false;
    history.replaceState(null, '', '#menu');
    window.scrollTo(0, 0);
  });
  document.getElementById('backToCalendar').addEventListener('click', function () {
    el.menuView.hidden = true;
    el.calendarApp.hidden = false;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    window.scrollTo(0, 0);
  });
  document.getElementById('fullscreenMenu').addEventListener('click', function () {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {
        showNotice('Full-screen mode is not available in this browser.');
      });
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen();
    }
  });
  el.uploadDialog.addEventListener('click', closeDialogs);
  el.editorDialog.addEventListener('click', closeDialogs);

  resetItemForm();
  renderAll();
  loadMenuRange(false);
  window.setInterval(function () {
    if (document.visibilityState === 'visible') loadMenuRange(true);
  }, 60000);
})();
