import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
    createYTask,
    extractAttributes,
    extractTags,
    parseTodoLine,
    parseTodoText,
    readYTask,
    replaceYTasks,
    serializeTodoLine,
    stripAttributesFromText,
    sortTasks,
    stripTagsFromText
} from '../src/todoModel.js';

test('parses active and completed todo.txt task fields', () => {
    const active = parseTodoLine('(B) 2026-09-27 Call +Home @phone');
    assert.equal(active.completed, false);
    assert.equal(active.priority, 'B');
    assert.equal(active.creationDate, '2026-09-27');
    assert.equal(active.text, 'Call +Home @phone');
    assert.deepEqual(active.projects, ['Home']);
    assert.deepEqual(active.contexts, ['phone']);

    const completed = parseTodoLine('x 2026-09-28 (A) 2026-09-27 Pay bill');
    assert.equal(completed.completed, true);
    assert.equal(completed.completionDate, '2026-09-28');
    assert.equal(completed.creationDate, '2026-09-27');
    assert.equal(completed.priority, 'A');
    assert.equal(completed.text, 'Pay bill');
});

test('stores task text and tags in Yjs shared types', () => {
    const parsed = parseTodoLine('Call +Home @phone +Home due:2026-10-01');
    const doc = new Y.Doc();
    const list = doc.getArray('todoItems');
    createYTask(parsed, doc, list);
    const task = list.get(0);
    const readTask = readYTask(task);
    assert.deepEqual(readTask, {
        id: parsed.id,
        completed: false,
        priority: null,
        completionDate: null,
        creationDate: readTask.creationDate,
        text: 'Call +Home @phone +Home',
        projects: ['Home'],
        contexts: ['phone'],
        attributes: { due: '2026-10-01' }
    });
    assert.match(readTask.creationDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(extractTags('No tags'), { projects: [], contexts: [] });
    assert.equal(stripTagsFromText('Call +Home @phone now'), 'Call now');
    assert.equal(stripTagsFromText('Email a@b.example today'), 'Email a@b.example today');
});

test('assigns missing creation and completion dates when storing tasks', () => {
    const task = parseTodoLine('x Finish the report');
    const doc = new Y.Doc();
    const list = doc.getArray('todoItems');
    createYTask(task, doc, list);

    const stored = readYTask(list.get(0));
    assert.match(stored.creationDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(stored.completionDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('replaces the shared task list with imported tasks in one operation', () => {
    const doc = new Y.Doc();
    const list = doc.getArray('todoItems');
    createYTask(parseTodoLine('Existing task'), doc, list);

    const importedTasks = parseTodoText('Imported one\nImported two');
    replaceYTasks(importedTasks, doc, list);

    assert.deepEqual(list.toArray().map((task) => readYTask(task).text), [
        'Imported one',
        'Imported two'
    ]);

    replaceYTasks([], doc, list);
    assert.equal(list.length, 0);
});

test('imports todo.txt lines and exports canonical task lines', () => {
    const tasks = parseTodoText(
        '\n# task list\n(A) 2026-09-27 Call +Home @phone due:2026-10-01 color:blue\r\nx 2026-09-28 (B) 2026-09-26 Pay bill\n'
    );
    assert.equal(tasks.length, 2);
    assert.equal(
        serializeTodoLine(tasks[0]),
        '(A) 2026-09-27 Call +Home @phone due:2026-10-01 color:blue'
    );
    assert.equal(tasks[0].text, 'Call +Home @phone');
    assert.deepEqual(tasks[0].attributes, { due: '2026-10-01', color: 'blue' });
    assert.equal(
        serializeTodoLine(tasks[1]),
        'x 2026-09-28 (B) 2026-09-26 Pay bill'
    );
    assert.deepEqual(parseTodoText(' \n# only comments\n'), []);
    assert.deepEqual(extractAttributes('Visit https://example.com status:open'), {
        status: 'open'
    });
    assert.equal(
        stripAttributesFromText('Call home due:2026-10-01'),
        'Call home'
    );
});

test('sorts by completion, priority, due date, creation date, and text', () => {
    const tasks = [
        {
            text: 'Completed early',
            completed: true,
            priority: 'A',
            creationDate: '2026-01-01',
            attributes: { due: '2026-01-01' }
        },
        {
            text: 'No priority',
            completed: false,
            priority: null,
            creationDate: '2026-01-01',
            attributes: {}
        },
        {
            text: 'Late due',
            completed: false,
            priority: 'A',
            creationDate: '2026-01-01',
            attributes: { due: '2026-02-01' }
        },
        {
            text: 'Zebra',
            completed: false,
            priority: 'A',
            creationDate: '2026-01-02',
            attributes: { due: '2026-01-01' }
        },
        {
            text: 'Apple',
            id: 'apple',
            completed: false,
            priority: 'A',
            creationDate: '2026-01-01',
            attributes: { due: '2026-01-01' }
        },
        {
            text: 'Beta',
            id: 'beta',
            completed: false,
            priority: 'A',
            creationDate: '2026-01-01',
            attributes: { due: '2026-01-01' }
        }
    ];

    assert.deepEqual(sortTasks(tasks).map((task) => task.text), [
        'Apple',
        'Beta',
        'Zebra',
        'Late due',
        'No priority',
        'Completed early'
    ]);
    assert.equal(tasks[0].text, 'Completed early');
});

test('merges independent edits from two Yjs replicas', () => {
    const first = new Y.Doc();
    const list = first.getArray('todoItems');
    const initialTask = {
        id: 'task-1',
        completed: false,
        priority: null,
        completionDate: null,
        creationDate: null,
        text: 'Original',
        projects: [],
        contexts: []
    };
    createYTask(initialTask, first, list);

    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    const firstTask = first.getArray('todoItems').get(0);
    const secondTask = second.getArray('todoItems').get(0);
    firstTask.set('priority', 'A');
    secondTask.set('completed', true);
    firstTask.get('text').insert(firstTask.get('text').length, ' alpha');
    secondTask.get('text').insert(secondTask.get('text').length, ' beta');

    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));

    const mergedFirst = readYTask(first.getArray('todoItems').get(0));
    const mergedSecond = readYTask(second.getArray('todoItems').get(0));
    assert.equal(mergedFirst.priority, 'A');
    assert.equal(mergedFirst.completed, true);
    assert.match(mergedFirst.text, /alpha/);
    assert.match(mergedFirst.text, /beta/);
    assert.deepEqual(mergedFirst, mergedSecond);
});
