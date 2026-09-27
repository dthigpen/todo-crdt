import * as Y from 'yjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_PATTERN = /^\([A-Z]\)$/;

export function createTaskId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

    const text = tokens.join(' ');
    return {
        id: createTaskId(),
        completed,
        priority,
        completionDate,
        creationDate,
        text,
        ...extractTags(text)
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
    fields.push(task.text);
    return fields.join(' ');
}

export function createYTask(task, doc, todoList) {
    const yTask = new Y.Map();
    const yText = new Y.Text();
    const projects = new Y.Array();
    const contexts = new Y.Array();

    yTask.set('id', task.id || createTaskId());
    yTask.set('completed', Boolean(task.completed));
    yTask.set('priority', task.priority || null);
    yTask.set('completionDate', task.completionDate || null);
    yTask.set('creationDate', task.creationDate || null);
    yTask.set('text', yText);
    yTask.set('projects', projects);
    yTask.set('contexts', contexts);

    doc.transact(() => {
        todoList.push([yTask]);
        if (task.text) yText.insert(0, task.text);
        if (task.projects.length) projects.push(task.projects);
        if (task.contexts.length) contexts.push(task.contexts);
    });
    return yTask;
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
        contexts: [...new Set(yTask.get('contexts').toArray())]
    };
}

export function replaceYArrayValues(array, values) {
    if (array.length) array.delete(0, array.length);
    if (values.length) array.push(values);
}
