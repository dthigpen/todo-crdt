import * as Y from 'yjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_PATTERN = /^\([A-Z]\)$/;
const ATTRIBUTE_PATTERN = /^([a-zA-Z][\w-]*):(\S+)$/;

export function extractAttributes(text) {
    const attributes = {};
    for (const token of text.split(/\s+/)) {
        const match = token.match(ATTRIBUTE_PATTERN);
        if (!match || ['http', 'https'].includes(match[1].toLowerCase())) continue;
        attributes[match[1].toLowerCase()] = match[2];
    }
    return attributes;
}

export function stripAttributesFromText(text) {
    return text
        .split(/\s+/)
        .filter((token) => {
            const match = token.match(ATTRIBUTE_PATTERN);
            return !match || ['http', 'https'].includes(match[1].toLowerCase());
        })
        .join(' ')
        .trim();
}

export function serializeTaskText(task) {
    return [stripAttributesFromText(task.text), ...Object.entries(task.attributes || {}).map(
        ([key, value]) => `${key}:${value}`
    )]
        .filter(Boolean)
        .join(' ');
}

export function createTaskId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
        const completionOrder = Number(Boolean(a.completed)) - Number(Boolean(b.completed));
        if (completionOrder) return completionOrder;

        const priorityOrder = compareOptional(a.priority, b.priority);
        if (priorityOrder) return priorityOrder;

        const dueOrder = compareOptional(a.attributes?.due, b.attributes?.due);
        if (dueOrder) return dueOrder;

        const creationOrder = compareOptional(a.creationDate, b.creationDate);
        if (creationOrder) return creationOrder;

        const aText = stripTagsFromText(stripAttributesFromText(a.text));
        const bText = stripTagsFromText(stripAttributesFromText(b.text));
        const foldedTextOrder = compareStrings(aText.toLowerCase(), bText.toLowerCase());
        if (foldedTextOrder) return foldedTextOrder;
        const exactTextOrder = compareStrings(aText, bText);
        if (exactTextOrder) return exactTextOrder;
        return compareStrings(a.id || '', b.id || '');
    });
}

function compareOptional(a, b) {
    if (!a) return b ? 1 : 0;
    if (!b) return -1;
    return compareStrings(a, b);
}

function compareStrings(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

export function extractTags(text) {
    return {
        projects: [...new Set([...text.matchAll(/\+([^\s]+)/g)].map((match) => match[1]))],
        contexts: [...new Set([...text.matchAll(/@([^\s]+)/g)].map((match) => match[1]))]
    };
}

export function stripTagsFromText(text) {
    return text
        .replace(/(?:^|\s)[+@][^\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseTodoLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const tokens = trimmed.split(/\s+/);
    const completed = tokens[0] === 'x';
    if (completed) tokens.shift();

    let completionDate = null;
    let creationDate = null;
    let priority = null;

    if (completed && DATE_PATTERN.test(tokens[0] || '')) {
        completionDate = tokens.shift();
    }
    if (PRIORITY_PATTERN.test(tokens[0] || '')) {
        priority = tokens.shift().slice(1, 2);
    }
    if (DATE_PATTERN.test(tokens[0] || '')) {
        creationDate = tokens.shift();
    }
    if (completed && priority === null && PRIORITY_PATTERN.test(tokens[0] || '')) {
        priority = tokens.shift().slice(1, 2);
    }

    const rawText = tokens.join(' ');
    const attributes = extractAttributes(rawText);
    const text = stripAttributesFromText(rawText);
    return {
        id: createTaskId(),
        completed,
        priority,
        completionDate,
        creationDate,
        text,
        ...extractTags(text),
        attributes
    };
}

export function parseTodoText(contents) {
    return contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map(parseTodoLine)
        .filter((task) => task?.text);
}

export function serializeTodoLine(task) {
    const fields = [];
    if (task.completed) {
        fields.push('x');
        if (task.completionDate) fields.push(task.completionDate);
    }
    if (task.priority) fields.push(`(${task.priority})`);
    if (task.creationDate) fields.push(task.creationDate);
    fields.push(stripAttributesFromText(task.text));
    fields.push(...Object.entries(task.attributes || {}).map(
        ([key, value]) => `${key}:${value}`
    ));
    return fields.join(' ');
}

function localDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

export function createYTask(task, doc, todoList) {
    const yTask = new Y.Map();
    const yText = new Y.Text();
    const projects = new Y.Array();
    const contexts = new Y.Array();
    const attributes = new Y.Map();

    yTask.set('id', task.id || createTaskId());
    yTask.set('completed', Boolean(task.completed));
    yTask.set('priority', task.priority || null);
    yTask.set(
        'completionDate',
        task.completionDate || (task.completed ? localDate() : null)
    );
    yTask.set('creationDate', task.creationDate || localDate());
    yTask.set('text', yText);
    yTask.set('projects', projects);
    yTask.set('contexts', contexts);
    for (const [key, value] of Object.entries(task.attributes || {})) {
        attributes.set(key, value);
    }
    yTask.set('attributes', attributes);

    doc.transact(() => {
        todoList.push([yTask]);
        if (task.text) yText.insert(0, task.text);
        if (task.projects.length) projects.push(task.projects);
        if (task.contexts.length) contexts.push(task.contexts);
    });
    return yTask;
}

export function replaceYTasks(tasks, doc, todoList) {
    doc.transact(() => {
        if (todoList.length) todoList.delete(0, todoList.length);
        for (const task of tasks) createYTask(task, doc, todoList);
    });
}

export function readYTask(yTask) {
    return {
        id: yTask.get('id'),
        completed: yTask.get('completed'),
        priority: yTask.get('priority'),
        completionDate: yTask.get('completionDate'),
        creationDate: yTask.get('creationDate'),
        text: yTask.get('text').toString(),
        projects: [...new Set(yTask.get('projects').toArray())],
        contexts: [...new Set(yTask.get('contexts').toArray())],
        attributes: Object.fromEntries(yTask.get('attributes')?.entries() || [])
    };
}

export function replaceYArrayValues(array, values) {
    if (array.length) array.delete(0, array.length);
    if (values.length) array.push(values);
}
