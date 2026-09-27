import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
    createYTask,
    extractTags,
    parseTodoLine,
    parseTodoText,
    readYTask,
    serializeTodoLine,
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
    const parsed = parseTodoLine('Call +Home @phone +Home');
    const doc = new Y.Doc();
    const list = doc.getArray('todoItems');
    createYTask(parsed, doc, list);
    const task = list.get(0);
    assert.deepEqual(readYTask(task), {
        id: parsed.id,
        completed: false,
        priority: null,
        completionDate: null,
        creationDate: null,
        text: 'Call +Home @phone +Home',
        projects: ['Home'],
        contexts: ['phone']
    });
    assert.deepEqual(extractTags('No tags'), { projects: [], contexts: [] });
    assert.equal(stripTagsFromText('Call +Home @phone now'), 'Call now');
    assert.equal(stripTagsFromText('Email a@b.example today'), 'Email a@b.example today');
});

test('imports todo.txt lines and exports canonical task lines', () => {
    const tasks = parseTodoText(
        '\n# task list\n(A) 2026-09-27 Call +Home @phone\r\nx 2026-09-28 (B) 2026-09-26 Pay bill\n'
    );
    assert.equal(tasks.length, 2);
    assert.equal(
        serializeTodoLine(tasks[0]),
        '(A) 2026-09-27 Call +Home @phone'
    );
    assert.equal(
        serializeTodoLine(tasks[1]),
        'x 2026-09-28 (B) 2026-09-26 Pay bill'
    );
    assert.deepEqual(parseTodoText(' \n# only comments\n'), []);
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
