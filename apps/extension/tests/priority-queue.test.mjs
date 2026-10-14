import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ViewportPriorityQueue } from '../src/core/priority-queue.ts';

/**
 * 调度器测试：验证批大小切分、并发上限、失败重试退避，
 * 以及流式逐段回填不会重复下发。
 *
 * 这些行为直接决定翻译速度，因此需要可回归的断言。
 */

/** 构造一个最小的假 TranslationUnit */
function unit(id, text = `text-${id}`) {
  const attrs = new Map();
  const element = {
    isConnected: true,
    setAttribute: (k, v) => attrs.set(k, v),
    getAttribute: (k) => attrs.get(k) ?? null,
    get textContent() {
      return text;
    },
    innerText: text,
  };
  return { id, text, element, sourceHash: `hash-${id}` };
}

/** 等待队列把 total 个单元全部处理完（或超时） */
async function drain(queue, total, timeoutMs = 5000) {
  const start = Date.now();
  while (queue.getStats().completed < total) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `drain 超时：completed=${queue.getStats().completed}，期望 ${total}`
      );
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function reply(ids, prefix = '译') {
  return {
    requestId: 'r',
    segments: ids.map((id) => ({ id, translation: `${prefix}-${id}` })),
    resolvedEngine: { id: 'fake' },
  };
}

describe('调度器：批大小与并发', () => {
  test('splits work into batches of the configured size', async () => {
    const batchSizes = [];
    const queue = new ViewportPriorityQueue({
      batchSize: 4,
      concurrency: 1,
      translateFn: async (req) => {
        batchSizes.push(req.segments.length);
        return reply(req.segments.map((s) => s.id));
      },
    });

    const units = Array.from({ length: 10 }, (_, i) => unit(`u${i}`));
    queue.enqueue(units);
    queue.start('zh-CN');
    await drain(queue, 10);

    // 10 段 / 每批 4 → 4,4,2
    assert.deepEqual(batchSizes, [4, 4, 2]);
    queue.destroy();
  });

  test('never exceeds the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;

    const queue = new ViewportPriorityQueue({
      batchSize: 2,
      concurrency: 2,
      translateFn: async (req) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return reply(req.segments.map((s) => s.id));
      },
    });

    const units = Array.from({ length: 12 }, (_, i) => unit(`c${i}`));
    queue.enqueue(units);
    queue.start('zh-CN');
    await drain(queue, 12);

    assert.ok(peak <= 2, `并发峰值应 <= 2，实际 ${peak}`);
    assert.ok(peak >= 2, `并发峰值应能达到 2，实际 ${peak}`);
    queue.destroy();
  });

  test('a single oversized segment occupies its own batch', async () => {
    const batchSizes = [];
    const queue = new ViewportPriorityQueue({
      batchSize: 8,
      concurrency: 1,
      translateFn: async (req) => {
        batchSizes.push(req.segments.length);
        return reply(req.segments.map((s) => s.id));
      },
    });

    const longText = 'x'.repeat(2000);
    // 队首为超长段落 → 应单独成批（长度 1）
    queue.enqueue([unit('long', longText), unit('a'), unit('b')]);
    queue.start('zh-CN');
    await drain(queue, 3);

    assert.equal(batchSizes[0], 1, '超长段落应单独成批');
    queue.destroy();
  });
});

describe('调度器：失败重试', () => {
  test('retries a failed batch and eventually succeeds', async () => {
    let attempts = 0;
    const queue = new ViewportPriorityQueue({
      batchSize: 2,
      concurrency: 1,
      maxRetries: 2,
      retryBaseDelayMs: 5, // 测试中缩短退避
      translateFn: async (req) => {
        attempts++;
        if (attempts < 3) throw new Error('transient failure');
        return reply(req.segments.map((s) => s.id));
      },
    });

    queue.enqueue([unit('r1'), unit('r2')]);
    queue.start('zh-CN');
    await drain(queue, 2);

    assert.equal(attempts, 3, '应在第 3 次尝试成功');
    assert.equal(queue.getStats().completed, 2);
    queue.destroy();
  });

  test('gives up after maxRetries and reports via onError', async () => {
    let attempts = 0;
    const errors = [];

    const queue = new ViewportPriorityQueue({
      batchSize: 1,
      concurrency: 1,
      maxRetries: 1,
      retryBaseDelayMs: 5,
      translateFn: async () => {
        attempts++;
        throw new Error('permanent failure');
      },
      onError: (err) => errors.push(err.message),
    });

    queue.enqueue([unit('e1')]);
    queue.start('zh-CN');

    const start = Date.now();
    while (errors.length === 0 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // 首次 + 1 次重试 = 2
    assert.equal(attempts, 2, '应重试 maxRetries 次后放弃');
    assert.equal(errors.length, 1);
    queue.destroy();
  });

  test('retry uses exponential backoff', async () => {
    const timestamps = [];
    const queue = new ViewportPriorityQueue({
      batchSize: 1,
      concurrency: 1,
      maxRetries: 3,
      retryBaseDelayMs: 30,
      translateFn: async () => {
        timestamps.push(Date.now());
        throw new Error('always fails');
      },
      onError: () => {},
    });

    queue.enqueue([unit('b1')]);
    queue.start('zh-CN');

    const start = Date.now();
    while (timestamps.length < 4 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 5));
    }

    assert.equal(timestamps.length, 4, '首次 + 3 次重试');
    // 退避应为 30 / 60 / 120，检查首间隔已明显拉长
    const gap1 = timestamps[1] - timestamps[0];
    assert.ok(gap1 >= 25, `首次退避应 >= 25ms，实际 ${gap1}ms`);
    queue.destroy();
  });
});

describe('调度器：流式逐段回填', () => {
  test('delivers segments incrementally and does not duplicate them on completion', async () => {
    const streamed = [];
    const batched = [];

    const queue = new ViewportPriorityQueue({
      batchSize: 3,
      concurrency: 1,
      translateFn: async (req, _signal, onSegment) => {
        // 模拟流式：逐段增量回调
        for (const s of req.segments) {
          const seg = { id: s.id, translation: `流-${s.id}` };
          streamed.push(seg.id);
          onSegment?.(seg);
          await new Promise((r) => setTimeout(r, 5));
        }
        return reply(req.segments.map((s) => s.id));
      },
      onSegmentTranslated: (u, seg) => streamed.push(`mount:${seg.id}`),
      onBatchTranslated: (_res, units) => batched.push(...units.map((u) => u.id)),
    });

    queue.enqueue([unit('s1'), unit('s2'), unit('s3')]);
    queue.start('zh-CN');
    await drain(queue, 3);

    // 每段都应被挂载且仅挂载一次
    const mounts = streamed.filter((s) => typeof s === 'string' && s.startsWith('mount:'));
    assert.equal(mounts.length, 3, `应挂载 3 次，实际 ${mounts.length}`);
    assert.deepEqual([...mounts].sort(), ['mount:s1', 'mount:s2', 'mount:s3']);

    // 已流式回填的段落不应再出现在兜底批次里
    assert.equal(batched.length, 0, `兜底不应重复下发，实际 ${JSON.stringify(batched)}`);
    queue.destroy();
  });

  test('falls back to batch delivery when no segments were streamed', async () => {
    const batched = [];

    const queue = new ViewportPriorityQueue({
      batchSize: 2,
      concurrency: 1,
      translateFn: async (req) => reply(req.segments.map((s) => s.id)),
      onSegmentTranslated: () => {
        throw new Error('不应被调用');
      },
      onBatchTranslated: (_res, units) => batched.push(...units.map((u) => u.id)),
    });

    queue.enqueue([unit('n1'), unit('n2')]);
    queue.start('zh-CN');
    await drain(queue, 2);

    assert.deepEqual(batched.sort(), ['n1', 'n2']);
    queue.destroy();
  });
});

describe('调度器：去重与统计', () => {
  test('ignores duplicate enqueues of the same segment id', async () => {
    let totalSegments = 0;
    const queue = new ViewportPriorityQueue({
      batchSize: 10,
      concurrency: 1,
      translateFn: async (req) => {
        totalSegments += req.segments.length;
        return reply(req.segments.map((s) => s.id));
      },
    });

    queue.enqueue([unit('d1'), unit('d2')]);
    queue.enqueue([unit('d1'), unit('d2')]); // 重复
    queue.start('zh-CN');
    await drain(queue, 2);

    assert.equal(totalSegments, 2, '重复入队不应重复翻译');
    assert.equal(queue.getStats().total, 2);
    queue.destroy();
  });
});
