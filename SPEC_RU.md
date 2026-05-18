# `@processengine/dataflows` v2 — SPEC_RU

**Статус:** Draft  
**Версия спецификации:** 0.1  
**Пакет:** `@processengine/dataflows`  
**Область:** dataflow artifacts, `PROCESS/DATA`, interop with `@processengine/rules`, `@processengine/mappings`, `@processengine/decisions`, `@processengine/semantics`

---

## Содержание

1. [Что нормативно определяется этим документом](#1-что-нормативно-определяется-этим-документом)
2. [Назначение и роль библиотеки](#2-назначение-и-роль-библиотеки)
3. [Non-goals и границы пакета](#3-non-goals-и-границы-пакета)
4. [Публичный API](#4-публичный-api)
5. [Options](#5-options)
6. [Source dataflow artifact](#6-source-dataflow-artifact)
7. [Pipeline item types](#7-pipeline-item-types)
8. [Field-level schema](#8-field-level-schema)
9. [PathRef и reference semantics](#9-pathref-и-reference-semantics)
10. [DataflowSchema и schemaRef](#10-dataflowschema-и-schemaref)
11. [Compile semantics](#11-compile-semantics)
12. [Prepared dataflow artifact contract](#12-prepared-dataflow-artifact-contract)
13. [Runtime input и registries](#13-runtime-input-и-registries)
14. [Runtime execution semantics](#14-runtime-execution-semantics)
15. [Read-after-write и writes atomicity](#15-read-after-write-и-writes-atomicity)
16. [Runtime result contract](#16-runtime-result-contract)
17. [Diagnostics](#17-diagnostics)
18. [Errors](#18-errors)
19. [Trace semantics](#19-trace-semantics)
20. [Boundary cases](#20-boundary-cases)
21. [JSON-safe / transport-safe guarantees](#21-json-safe--transport-safe-guarantees)
22. [Interop with rules/mappings/decisions/semantics](#22-interop-with-rulesmappingsdecisionssemantics)
23. [Examples](#23-examples)
24. [Compatibility](#24-compatibility)
25. [Migration](#25-migration)
26. [Testing, CI и release readiness](#26-testing-ci-и-release-readiness)
27. [Acceptance criteria](#27-acceptance-criteria)

---

## 1. Что нормативно определяется этим документом

Этот документ является нормативной спецификацией пакета `@processengine/dataflows` v2.

Нормативно определяются:

- роль пакета в семействе ProcessEngine;
- публичный API пакета;
- форма source dataflow artifact;
- допустимые pipeline item types;
- field-level schema dataflow artifact;
- semantics `PathRef` и reference resolution;
- правила `schema` и `schemaRef`;
- compile semantics для `validateDataflow` и `prepareDataflow`;
- prepared dataflow artifact contract;
- runtime input и registries;
- runtime execution semantics для `executeDataflow`;
- `read-after-write` semantics;
- runtime result contract (`DataflowOutput`);
- diagnostics and errors;
- trace semantics;
- boundary cases;
- JSON-safe / transport-safe guarantees;
- interop requirements with `rules`, `mappings`, `decisions`, `semantics`;
- compatibility и migration expectations;
- testing, CI, smoke и release readiness.

Объяснительные разделы, примеры и мотивационные комментарии не отменяют нормативные правила. При конфликте между prose-объяснением и разделами с field tables, semantics, diagnostics, runtime result или boundary cases источником истины считаются нормативные разделы.

Intentionally internal и не считаются публичным контрактом:

- конкретная внутренняя структура кешей;
- внутренние оптимизации prepared artifact;
- конкретная стратегия копирования state, если она сохраняет JSON-safe observable behavior;
- internal helper functions, не экспортируемые публично.

---

## 2. Назначение и роль библиотеки

`@processengine/dataflows` — библиотека семейства ProcessEngine для валидации, подготовки и исполнения **dataflow artifacts**.

Dataflow artifact описывает линейную синхронную обработку данных внутри одного flow-level шага:

```text
PROCESS/DATA
```

`@processengine/dataflows` композирует уже существующие предметные библиотеки:

```text
@processengine/rules
@processengine/mappings
@processengine/decisions
```

Пакет не является новым rules engine, mappings engine или decisions engine. Его ответственность — композиция:

```text
MAPPINGS / RULES / DECISIONS
  → линейный dataflow pipeline
  → explicit writes[]
```

Каноническая роль в Flow 5:

```text
orchestrator
  → plan(preparedFlow, state)
  → executeStep(PROCESS/DATA)
      → processor runtime вызывает executeDataflow(...)
  → reduce(step, state, DataflowOutput)
  → persist(state)
```

`@processengine/dataflows` возвращает только `DataflowOutput`. Он не применяет writes к реальному process state и не двигает процесс.

---

## 3. Non-goals и границы пакета

`@processengine/dataflows` намеренно не делает следующее:

- не знает flow-граф;
- не планирует process steps;
- не вызывает `reduce`;
- не двигает `currentStepId`;
- не сохраняет state;
- не владеет retry/fail policy;
- не исполняет `PROCESS/DATA` как flow-level step самостоятельно;
- не исполняет `CONTROL/ROUTE`;
- не исполняет `EFFECT/*`;
- не исполняет `WAIT/*`;
- не исполняет `TERMINAL/*`;
- не вызывает external I/O;
- не маршрутизирует процесс;
- не выполняет mapping/rules/decision logic своими операторами;
- не допускает nested dataflows;
- не поддерживает branching внутри dataflow pipeline;
- не поддерживает dynamic/computed refs.

Пакет делает только:

- `validateDataflow`;
- `prepareDataflow`;
- `executeDataflow`;
- извлечение/разрешение schema;
- вывод `readSet` и `writeSet`;
- последовательное исполнение pipeline items через registries;
- сбор `DataflowOutput.writes[]`;
- сбор optional trace.

---

## 4. Публичный API

Пакет следует каноническому жизненному циклу семейства ProcessEngine:

```text
validate → prepare → execute
```

### 4.1. Exports

```ts
export function validateDataflow(
  source: DataflowSource,
  options?: ValidateDataflowOptions
): ValidationResult;

export function prepareDataflow(
  source: DataflowSource,
  options?: PrepareDataflowOptions
): DataflowArtifact;

export function executeDataflow(
  artifact: DataflowArtifact,
  input: DataflowExecutionInput,
  options?: ExecuteDataflowOptions
): DataflowOutput;

export function extractDataflowSchema(
  source: DataflowSource,
  options?: ExtractDataflowSchemaOptions
): DataflowSchema;

export function formatDataflowDiagnostics(
  diagnostics: DataflowDiagnostic[]
): string;

export function formatDataflowRuntimeError(
  error: DataflowRuntimeError
): string;
```

### 4.2. `validateDataflow`

`validateDataflow` проверяет source artifact без исполнения.

Нормативно:

- не бросает исключение для невалидного artifact;
- возвращает `ValidationResult`;
- пригоден для CI, редакторов, песочниц, тестов и tooling;
- может работать в `standalone` режиме без полного artifact-set;
- может использовать переданные registries для локальной проверки ссылок на runtime artifacts.

```ts
interface ValidationResult {
  ok: boolean;
  diagnostics: DataflowDiagnostic[];
}
```

### 4.3. `prepareDataflow`

`prepareDataflow` выполняет нормативную подготовку artifact к runtime.

Нормативно:

- вызывает/использует compile validation;
- бросает `DataflowCompileError`, если source невалиден;
- возвращает immutable prepared `DataflowArtifact`;
- не исполняет pipeline;
- не мутирует source.

### 4.4. `executeDataflow`

`executeDataflow` исполняет только prepared artifact.

Нормативно:

- не выполняет скрытую compile-фазу;
- не принимает source artifact;
- не мутирует prepared artifact;
- не мутирует исходный process state;
- возвращает `DataflowOutput` только при полном success-path;
- бросает `DataflowRuntimeError` при runtime failure;
- не применяет writes к реальному state.

---

## 5. Options

### 5.1. `ValidateDataflowOptions`

```ts
interface ValidateDataflowOptions {
  schemaRegistry?: SchemaArtifactRegistry;
  artifactRegistries?: Partial<DataflowArtifactRegistries>;
}
```

Смысл:

| Поле | Смысл |
|---|---|
| `schemaRegistry` | используется для разрешения `schemaRef` |
| `artifactRegistries` | используется для проверки существования referenced artifacts и MAPPINGS kind consistency |

`@processengine/dataflows` v2 валидирует локальный dataflow artifact. Проверки полной Process Data Schema и всего artifact-set принадлежат отдельному artifact-set compiler, а не этому runtime-пакету.

### 5.2. `PrepareDataflowOptions`

```ts
interface PrepareDataflowOptions {
  schemaRegistry?: SchemaArtifactRegistry;
  artifactRegistries?: Partial<DataflowArtifactRegistries>;
  freeze?: boolean;
}
```

Default:

```text
freeze: true
```

Если `freeze: true`, prepared artifact должен быть immutable с точки зрения публичного контракта.

### 5.3. `ExecuteDataflowOptions`

```ts
interface ExecuteDataflowOptions {
  trace?: 'off' | 'basic' | 'verbose';
  runtimeSchemaValidation?: false | 'assert';
  redaction?: DataflowTraceRedactionOptions;
}
```

Default:

```text
trace: 'off'
runtimeSchemaValidation: false
```

`runtimeSchemaValidation: "assert"` в v2 является минимальной проверкой объявленных top-level fields. Если schema node содержит `fields`, output должен быть plain object; для присутствующих полей с `type` проверяется фактический JSON type. V2 не выполняет full JSON Schema validation: не проверяет required, additionalProperties, nested fields, array items и nullability.

---

## 6. Source dataflow artifact

### 6.1. Top-level shape

```ts
interface DataflowSource {
  id: string;
  version: string;

  title?: string;
  description?: string;

  schema?: DataflowSchema;
  schemaRef?: string;

  pipeline: DataflowPipelineItemSource[];
  metadata?: Record<string, JsonValue>;
}
```

### 6.2. Field table

| Поле | Тип | Required | Смысл | Compile constraints |
|---|---|---:|---|---|
| `id` | `string` | да | Идентификатор dataflow artifact | non-empty, stable внутри artifact-set |
| `version` | `string` | да | Версия artifact | non-empty |
| `title` | `string` | нет | Бизнес-название для UI | JSON-safe |
| `description` | `string` | нет | Описание для UI/docs | JSON-safe |
| `schema` | `DataflowSchema` | условно | Inline schema | ровно одно из `schema` / `schemaRef` |
| `schemaRef` | `string` | условно | Ссылка на schema artifact | ровно одно из `schema` / `schemaRef` |
| `pipeline` | `DataflowPipelineItemSource[]` | да | Линейная последовательность items | non-empty array |
| `metadata` | `Record<string, JsonValue>` | нет | Дополнительные метаданные | JSON-safe |

### 6.3. Нормативные ограничения

- `pipeline` является строго линейным массивом;
- порядок элементов pipeline является порядком исполнения;
- branching внутри pipeline не поддерживается;
- вложенные dataflows не поддерживаются;
- `schema` и `schemaRef` взаимоисключающие;
- отсутствие обоих — compile error;
- `pipeline` не может быть пустым;
- `metadata` не влияет на runtime semantics.

---


### 6.4. Strict object contract

`DataflowSource`, pipeline items, `contract`, `contract.input` and `contract.output` are strict objects.
Fields not defined by this SPEC are compile-time errors, not ignored hints.

- unknown top-level source field → `DATAFLOW_SOURCE_FORBIDDEN_FIELD`;
- unknown pipeline item field → `DATAFLOW_ITEM_FORBIDDEN_FIELD`;
- unknown contract/input/output field → `DATAFLOW_ITEM_CONTRACT_FORBIDDEN_FIELD`.

`kind` is allowed only on `MAPPINGS` items. `RULES` and `DECISIONS` items must not define `kind`.

## 7. Pipeline item types

Pipeline item types в dataflow являются операторами композиции dataflow. Они не реализуют собственную бизнес-логику внутри `@processengine/dataflows`; они делегируют исполнение соответствующей библиотеке семейства.

Допустимые item types:

```text
MAPPINGS
RULES
DECISIONS
```

Запрещённые item types:

```text
PROCESS/DATA
CONTROL/ROUTE
EFFECT/*
WAIT/*
TERMINAL/*
```

Flow-level step types не являются pipeline item types.

### 7.1. Common item shape

```ts
interface DataflowInputContract {
  refs: Record<InputTargetPath, PathRef>;
}

interface DataflowPipelineItemBase {
  id: string;
  type: 'MAPPINGS' | 'RULES' | 'DECISIONS';
  artefactId: string;
  contract: {
    input: DataflowInputContract;
    output: { ref: PathRef };
  };
  title?: string;
  description?: string;
  metadata?: Record<string, JsonValue>;
}
```

`contract.input` has exactly one normative v2 shape: `{ refs: Record<InputTargetPath, PathRef> }`.
`contract.input.refs` reads one or more values from `workingState` and builds the child input.
The special target `$` passes the resolved value as the whole child input and must not be mixed with named targets.
Named targets assemble a compact object; dotted targets create nested objects.

| Поле | Тип | Required | Runtime meaning |
|---|---|---:|---|
| `id` | `string` | да | Идентификатор item внутри pipeline |
| `type` | enum | да | Выбирает registry/runtime |
| `artefactId` | `string` | да | Ссылка на prepared artifact соседней библиотеки |
| `contract.input.refs` | `Record<InputTargetPath, PathRef>` | да | Прочитать direct `$` input или собрать compact object из named refs |
| `contract.output.ref` | `PathRef` | да | Куда записать output в workingState и `writes[]` |
| `title` | `string` | нет | UI title |
| `description` | `string` | нет | UI description |
| `metadata` | object | нет | JSON-safe metadata без runtime semantics |

### 7.2. MAPPINGS item semantics

```ts
interface MappingsDataflowItem extends DataflowPipelineItemBase {
  type: 'MAPPINGS';
  kind: 'payload' | 'facts' | 'result';
}
```

Runtime semantics:

1. Собрать item input из `workingState` по `contract.input.refs`.
2. Найти mapping artifact по `artefactId`.
3. Исполнить его через канонический runtime `executeMappings(...)`.
4. Записать output по `contract.output.ref`.
5. Добавить write `{ ref, value, itemId }`.

Compile constraints:

- `kind` обязателен;
- referenced mapping artifact обязан иметь `kind`;
- `item.kind` должен совпадать с `mapping.kind`;
- output ref должен быть объявлен в schema;
- output ref должен находиться под `$.context.data.*`.

### 7.3. RULES item semantics

```ts
interface RulesDataflowItem extends DataflowPipelineItemBase {
  type: 'RULES';
}
```

Runtime semantics:

1. Собрать item input из `workingState` по `contract.input.refs`.
2. Найти rules artifact по `artefactId`.
3. Исполнить его через канонический runtime `evaluateRules(...)`.
4. Записать rules result по `contract.output.ref`.
5. Добавить write `{ ref, value, itemId }`.

Рекомендуемый output namespace:

```text
$.context.data.checks.*
```

Это рекомендация модели данных, а не магическое runtime-правило. Источник истины — `contract.output.ref` и schema.

### 7.4. DECISIONS item semantics

```ts
interface DecisionsDataflowItem extends DataflowPipelineItemBase {
  type: 'DECISIONS';
}
```

Runtime semantics:

1. Собрать item input из `workingState` по `contract.input.refs`.
2. Найти decisions artifact по `artefactId`.
3. Исполнить его через канонический runtime `evaluateDecisions(...)`.
4. Записать decision result по `contract.output.ref`.
5. Добавить write `{ ref, value, itemId }`.

Рекомендуемый output namespace:

```text
$.context.data.decisions.*
```

---

## 8. Field-level schema

### 8.1. `PathRef`

```ts
type PathRef = string;
```

Нормативно:

- должен быть статической строкой;
- должен начинаться с `$.`;
- dynamic/computed refs запрещены;
- ref должен указывать на JSON-like path в process state;
- ref normalization не должна менять source artifact semantics.

### 8.2. `DataflowSchema`

```ts
interface DataflowSchema {
  [rootPath: PathRef]: SchemaNode;
}
```

Root paths:

- должны использовать `$.` prefix;
- должны описывать output roots, а не вложенные leaf paths;
- должны соответствовать `contract.output.ref` pipeline items;
- каждый schema node обязан иметь непустые `title` и `description`;
- каждое поле внутри `fields` обязано иметь непустые `title` и `description`.

### 8.3. `JsonValue`

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
```

`undefined`, `Date`, `Map`, `Set`, `BigInt`, class instances, functions, symbols and cyclic structures не являются `JsonValue`.

---

## 9. PathRef и reference semantics

### 9.1. Read refs

Input refs могут читать:

```text
$.context.input
$.context.input.*
$.context.effects
$.context.effects.*
$.context.data
$.context.data.*
```

### 9.2. Write refs

Output refs могут писать только:

```text
$.context.data.*
```

Запрещено писать в:

```text
$.context.input.*
$.context.effects.*
$.context.steps.*
$.result
$.status
любые paths вне $.context.data.*
```

### 9.3. Read-after-write scope

Pipeline item может читать:

- данные, существующие во входном process state;
- outputs предыдущих pipeline items;
- outputs предыдущих DATA-шагов процесса, уже применённые в real state.

Pipeline item не может читать output item-а, который расположен позже в pipeline. Такое чтение является compile error `DATAFLOW_READ_FROM_FUTURE_ITEM`, если future dependency выводится статически из `readSet/writeSet`.

### 9.4. Unresolvable refs

Если любой `contract.input.refs[target]` не существует в `workingState` во время runtime, `executeDataflow` бросает `DataflowRuntimeError` с кодом:

```text
DATAFLOW_INPUT_REF_NOT_FOUND
```

Если конкретный mapping/rules/decisions artifact должен обрабатывать отсутствие вложенного поля, input contract должен указывать на существующий родительский объект, а missing nested field должен обрабатываться внутри соответствующего artifact.

---

## 10. DataflowSchema и schemaRef

### 10.1. Ровно один источник schema

Для каждого dataflow source обязательно ровно одно:

```text
schema
schemaRef
```

| Состояние | Результат |
|---|---|
| Есть `schema`, нет `schemaRef` | ok |
| Есть `schemaRef`, нет `schema` | ok |
| Есть оба | compile diagnostic `DATAFLOW_SCHEMA_AMBIGUOUS` |
| Нет обоих | compile diagnostic `DATAFLOW_SCHEMA_MISSING` |

### 10.2. Inline schema

Inline schema находится внутри dataflow source.

```json
{
  "schema": {
    "$.context.data.facts.clientComparison": {
      "title": "Факты по клиенту",
      "description": "Набор признаков по найденным карточкам клиента, используемый decision-слоем.",
      "fields": {
        "hasCriticalMismatches": {
          "type": "boolean",
          "title": "Есть критичные расхождения",
          "description": "true, если среди расхождений клиента есть хотя бы одно критичное."
        }
      }
    }
  }
}
```

### 10.3. schemaRef

`schemaRef` указывает на отдельный schema artifact из того же artifact-set.

```json
{
  "schemaRef": "schema.abs.evaluate_resolution"
}
```

Для разрешения `schemaRef` в `prepareDataflow` должен быть передан `schemaRegistry`.

Если `schemaRef` не найден:

```text
DATAFLOW_SCHEMA_REF_NOT_FOUND
```

### 10.4. Output root rule

Каждый `contract.output.ref` pipeline item должен быть объявлен как root в resolved schema.

Пример:

```text
contract.output.ref = $.context.data.facts.clientComparison
```

schema must contain:

```text
$.context.data.facts.clientComparison
```

---

## 11. Compile semantics

### 11.1. Validate stages

`validateDataflow` выполняет следующие стадии:

1. **Source shape validation**
   - source object;
   - `id`, `version`, `pipeline`;
   - JSON-safe metadata.

2. **Schema source validation**
   - ровно одно из `schema` / `schemaRef`;
   - schema root path format;
   - schemaRef resolution if registry provided.

3. **Pipeline structure validation**
   - non-empty array;
   - unique item ids;
   - supported item types only.

4. **Item field validation**
   - required fields;
   - contract presence;
   - static `PathRef`;
   - `$.` prefix.

5. **Reference validation**
   - output refs under `$.context.data.*`;
   - duplicate writes;
   - in-place read/write;
   - output refs declared in schema;
   - read-from-future detection.

6. **Registry validation** if registries provided
   - referenced artifact exists;
   - MAPPINGS item kind matches mapping artifact kind.

### 11.2. Prepare stages

`prepareDataflow`:

1. Выполняет compile validation.
2. Если есть validation errors — бросает `DataflowCompileError`.
3. Разрешает `schemaRef` в concrete `schema`.
4. Нормализует paths.
5. Выводит `readSet` и `writeSet`.
6. Формирует prepared items.
7. Возвращает immutable `DataflowArtifact`.

---

## 12. Prepared dataflow artifact contract

### 12.1. Shape

```ts
interface DataflowArtifact {
  artifactType: 'dataflow';
  id: string;
  version: string;

  title?: string;
  description?: string;

  schema: ResolvedDataflowSchema;

  readSet: PathRef[];
  writeSet: PathRef[];

  items: PreparedDataflowItem[];

  metadata?: Record<string, JsonValue>;
}

interface PreparedDataflowItem {
  id: string;
  type: 'MAPPINGS' | 'RULES' | 'DECISIONS';
  artefactId: string;
  contract: {
    input: DataflowInputContract;
    output: { ref: PathRef };
  };
  kind?: 'payload' | 'facts' | 'result';
  title?: string;
  description?: string;
  metadata?: Record<string, JsonValue>;
}
```

### 12.2. Public fields

Публичным контрактом prepared artifact являются:

- `artifactType`;
- `id`;
- `version`;
- `schema`;
- `readSet`;
- `writeSet`;
- `items[].id`;
- `items[].type`;
- `items[].artefactId`;
- `items[].contract`;
- `items[].kind` для MAPPINGS;
- JSON-safe metadata.

### 12.3. Serialization

`DataflowArtifact` **должен быть JSON-safe и сериализуемым**.

Нормативно:

- prepared artifact может быть сериализован и восстановлен без потери публичного смысла;
- runtime-entrypoint `executeDataflow` должен принимать восстановленный prepared artifact, если его публичная форма сохранена;
- internal caches не входят в serialized public contract;
- prepared artifact не должен содержать функций, классов, циклических ссылок, Date, Map, Set, BigInt, Symbol.

### 12.4. Immutability

Runtime-entrypoint не должен мутировать prepared artifact.

Если `prepareDataflow(..., { freeze: true })`, implementation должен делать prepared artifact immutable или вести себя как immutable с точки зрения публичного контракта.

---

## 13. Runtime input и registries

### 13.1. Execution input

```ts
interface DataflowExecutionInput {
  state: ProcessState;
  registries: DataflowRegistries;
}
```

`state` должен быть JSON-safe process state. `executeDataflow` не мутирует `state`.

### 13.2. Registries

```ts
interface DataflowRegistries {
  mappings?: {
    get(id: string): PreparedMappingArtifact | undefined;
    executeMappings(artifact: PreparedMappingArtifact, input: JsonValue): { output: JsonValue; trace?: JsonValue[] };
  };

  rules?: {
    get(id: string): PreparedRulesArtifact | undefined;
    evaluateRules(artifact: PreparedRulesArtifact, input: JsonValue): { output: JsonValue; trace?: JsonValue[] };
  };

  decisions?: {
    get(id: string): PreparedDecisionsArtifact | undefined;
    evaluateDecisions(artifact: PreparedDecisionsArtifact, input: JsonValue): { output: JsonValue; trace?: JsonValue[] };
  };

  schemas?: SchemaArtifactRegistry;
}
```

Методы registry являются адаптерами над каноническими runtime-функциями семейства:

```text
executeMappings(...)
evaluateRules(...)
evaluateDecisions(...)
```

Registry может быть реализован как прямой wrapper вокруг соответствующих пакетов. Registry для конкретного item type обязателен только если pipeline содержит item такого типа; отсутствие нужного registry или метода в runtime приводит к typed `DataflowRuntimeError`.

---

## 14. Runtime execution semantics

Нормативный алгоритм `executeDataflow`:

```text
executeDataflow(artifact, input, options):
  workingState = jsonSafeCopy(input.state)
  writes = []
  trace = [] if trace enabled

  for item in artifact.items in order:
    itemInput = resolveInputRefs(workingState, item.contract.input.refs)
    if itemInput missing:
      throw DATAFLOW_INPUT_REF_NOT_FOUND

    referencedArtifact = registry.get(item.artefactId)
    if missing:
      throw DATAFLOW_ITEM_ARTIFACT_NOT_FOUND

    runtimeResult = execute item using canonical registry runtime
    assert runtimeResult has canonical shape { output, trace? }
    itemOutput = runtimeResult.output
    ignore runtimeResult.trace in dataflows v2

    assert itemOutput is JSON-safe
    assert item.contract.output.ref starts with $.context.data.
    assert item.contract.output.ref is declared in artifact.schema

    if runtimeSchemaValidation === 'assert':
      validate v2 minimal declared top-level field types of itemOutput against schema at output ref; if schema node declares fields, itemOutput must be object

    writes.push({
      ref: item.contract.output.ref,
      value: itemOutput,
      itemId: item.id
    })

    write itemOutput into workingState at item.contract.output.ref
    append trace event if enabled

  return { writes, trace? }

On runtime failure:
  if trace is enabled, attach partial failure trace to DataflowRuntimeError.details.trace
  do not return partial writes
```

Нормативные свойства:

- items исполняются строго в порядке массива;
- исходный state не мутируется;
- prepared artifact не мутируется;
- каждый item видит writes предыдущих items через workingState;
- writes возвращаются только при полном успехе;
- при runtime error partial writes не возвращаются;
- пакет не применяет writes к реальному process state.

---

## 15. Read-after-write и writes atomicity

### 15.1. Read-after-write

После успешного исполнения item-а его output записывается в `workingState`. Следующие items читают из `workingState` и видят это значение.

### 15.2. Atomicity

`executeDataflow` возвращает `writes[]` только если весь pipeline завершился успешно.

Если любой item падает:

- execution останавливается;
- `DataflowOutput` не возвращается;
- partial writes не возвращаются;
- реальный process state не меняется;
- orchestrator/processor runtime решают retry/fail вне `@processengine/dataflows`.

### 15.3. Relationship with semantics.reduce

`@processengine/dataflows` не применяет writes. Writes применяются `@processengine/semantics` в `reduce(PROCESS/DATA, DataflowOutput)`.

---

## 16. Runtime result contract

### 16.1. Shape

```ts
interface DataflowOutput {
  writes: DataflowWrite[];
  trace?: DataflowTraceEntry[];
}

interface DataflowWrite {
  ref: PathRef;
  value: JsonValue;
  itemId: string;
}
```

### 16.2. Fields

| Поле | Required | Смысл |
|---|---:|---|
| `writes` | да | Explicit writes, применяемые downstream semantics |
| `trace` | нет | Trace events, если trace включён |

`writes` должен быть JSON-safe. `DataflowWrite.value` должен быть JSON-safe.

### 16.3. Success-path vs runtime failure

`DataflowOutput` существует только на success-path.

Runtime failure выражается исключением `DataflowRuntimeError`, а не `DataflowOutput` с partial result.

---

## 17. Diagnostics

### 17.1. Shape

```ts
interface DataflowDiagnostic {
  code: DataflowDiagnosticCode;
  level: 'error' | 'warning';
  message: string;
  path?: string;
  details?: Record<string, JsonValue>;
}
```

### 17.2. Codes

```text
DATAFLOW_SCHEMA_MISSING
DATAFLOW_SCHEMA_AMBIGUOUS
DATAFLOW_SCHEMA_REF_NOT_FOUND
DATAFLOW_PIPELINE_EMPTY
DATAFLOW_ITEM_TYPE_UNSUPPORTED
DATAFLOW_ITEM_ID_DUPLICATE
DATAFLOW_ITEM_CONTRACT_MISSING
DATAFLOW_PATH_INVALID
DATAFLOW_PATH_DYNAMIC_FORBIDDEN
DATAFLOW_WRITE_FORBIDDEN_PATH
DATAFLOW_WRITE_NOT_IN_SCHEMA
DATAFLOW_WRITE_CONFLICT
DATAFLOW_INPLACE_WRITE
DATAFLOW_READ_FROM_FUTURE_ITEM
DATAFLOW_ITEM_ARTEFACT_NOT_FOUND
DATAFLOW_MAPPING_KIND_MISMATCH
DATAFLOW_METADATA_NOT_JSON_SAFE
```

Diagnostics are part of public contract.

---

## 18. Errors

### 18.1. Compile error

```ts
class DataflowCompileError extends Error {
  code: 'DATAFLOW_COMPILE_ERROR';
  diagnostics: DataflowDiagnostic[];
  cause?: unknown;
}
```

Thrown by `prepareDataflow` when source cannot be prepared.

### 18.2. Runtime error

```ts
class DataflowRuntimeError extends Error {
  code: DataflowRuntimeErrorCode;
  message: string;
  details?: Record<string, JsonValue>;
  cause?: unknown;
}
```

Runtime codes:

```text
DATAFLOW_ITEM_ARTIFACT_NOT_FOUND
DATAFLOW_ITEM_EXECUTION_FAILED
DATAFLOW_INPUT_REF_NOT_FOUND
DATAFLOW_OUTPUT_SCHEMA_INVALID
DATAFLOW_OUTPUT_NOT_JSON_SAFE
DATAFLOW_WRITE_FORBIDDEN_PATH
DATAFLOW_INTERNAL_ERROR
```

### 18.3. Formatters

```ts
formatDataflowDiagnostics(diagnostics): string
formatDataflowRuntimeError(error): string
```

Formatters are for CLI/logs/debugging and do not replace structured objects.

---

## 19. Trace semantics

### 19.1. Trace modes

```ts
type TraceMode = 'off' | 'basic' | 'verbose';
```

Default:

```text
'off'
```

### 19.2. Trace event shape

Trace event follows family trace shape and includes `step`.

```ts
interface DataflowTraceEntry {
  kind: 'DATAFLOW_ITEM_COMPLETED' | 'DATAFLOW_ITEM_FAILED';
  artifactType: 'dataflow';
  artifactId: string;
  step: {
    id: string;
    type: 'MAPPINGS' | 'RULES' | 'DECISIONS';
    artefactId: string;
  };
  at: string;
  outcome: 'completed' | 'failed';
  details?: Record<string, JsonValue>;
  input?: JsonValue;
  output?: JsonValue;
}
```

`step.id` is the pipeline item id. `step.type` is the pipeline item type. On success, trace is returned in `DataflowOutput.trace`. On runtime failure, if trace was enabled, partial failure trace is attached to `DataflowRuntimeError.details.trace`; partial writes are never returned.

### 19.3. Basic trace

Basic trace includes:

```text
kind
artifactType
artifactId
step.id
step.type
step.artefactId
at
outcome
inputRef/outputRef in details
```

Basic trace must not include raw input/output values by default.

### 19.4. Verbose trace

Verbose trace may include:

```text
input
output
schema validation details
timing details
```

Values are subject to redaction.

### 19.5. Redaction

Trace must not become an accidental leak channel. `ExecuteDataflowOptions.redaction` may define masking rules. If redaction is not configured, basic trace remains value-safe by default. Redaction functions MUST return JSON-safe values; otherwise runtime MUST throw `DATAFLOW_TRACE_NOT_JSON_SAFE` because `DataflowOutput.trace` is part of the public transport-safe result.

---

## 20. Boundary cases

| Case | Behavior |
|---|---|
| Empty pipeline | compile error `DATAFLOW_PIPELINE_EMPTY` |
| Missing schema and schemaRef | compile error `DATAFLOW_SCHEMA_MISSING` |
| Both schema and schemaRef | compile error `DATAFLOW_SCHEMA_AMBIGUOUS` |
| Unknown item type | compile error `DATAFLOW_ITEM_TYPE_UNSUPPORTED` |
| Duplicate item id | compile error `DATAFLOW_ITEM_ID_DUPLICATE` |
| Duplicate output ref | compile error `DATAFLOW_WRITE_CONFLICT` |
| any input.refs value === output.ref | compile error `DATAFLOW_INPLACE_WRITE` |
| Output ref outside `$.context.data.*` | compile error `DATAFLOW_WRITE_FORBIDDEN_PATH` |
| Output ref not in schema | compile error `DATAFLOW_WRITE_NOT_IN_SCHEMA` |
| Read from future item | compile error `DATAFLOW_READ_FROM_FUTURE_ITEM` |
| Missing input ref at runtime | runtime error `DATAFLOW_INPUT_REF_NOT_FOUND` |
| Referenced artifact missing at runtime | runtime error `DATAFLOW_ITEM_ARTIFACT_NOT_FOUND` |
| Item runtime throws | runtime error `DATAFLOW_ITEM_EXECUTION_FAILED` |
| Item returns `undefined` | runtime error `DATAFLOW_OUTPUT_NOT_JSON_SAFE` |
| Item returns non-JSON-safe value | runtime error `DATAFLOW_OUTPUT_NOT_JSON_SAFE` |
| Runtime schema validation fails | runtime error `DATAFLOW_OUTPUT_SCHEMA_INVALID` |
| verbose redaction returns non-JSON-safe value | runtime error `DATAFLOW_TRACE_NOT_JSON_SAFE` |
| trace='off' | `trace` absent |

---

## 21. JSON-safe / transport-safe guarantees

`DataflowOutput` is a public runtime result and natural input for downstream `@processengine/semantics.reduce(PROCESS/DATA, output)`.

Therefore:

- `DataflowOutput` must be JSON-safe;
- `DataflowWrite` must be JSON-safe;
- `DataflowWrite.value` must be JSON-safe;
- `trace`, if present, must be JSON-safe;
- `undefined` is not allowed in public runtime shape;
- functions/classes/Date/Map/Set/BigInt/Symbol/cyclic structures are not allowed;
- no host-service cleanup is required before passing output to semantics.

If a pipeline item returns a non-JSON-safe output, `executeDataflow` must fail with `DATAFLOW_OUTPUT_NOT_JSON_SAFE`.

---

## 22. Interop with rules/mappings/decisions/semantics

### 22.1. rules → dataflow

`RULES` item accepts direct output of `evaluateRules(...)` as JSON-safe value and writes it to `$.context.data.checks.*` or another schema-declared output ref.

### 22.2. mappings → decisions through dataflow

`MAPPINGS` item output can be used directly as `DECISIONS` item input through read-after-write without host cleanup.

Required pattern:

```text
MAPPINGS kind=facts
  output: $.context.data.facts.X
DECISIONS
  input: $.context.data.facts.X
```

### 22.3. dataflow → semantics.reduce

`executeDataflow(...)` returns `DataflowOutput.writes[]`. This output is valid input for `@processengine/semantics.reduce(PROCESS/DATA, state, output)` without manual normalization.

### 22.4. Contract tests required

Required contract tests:

```text
rules result → dataflow RULES item output
mappings output → dataflow DECISIONS item input
mappings output → decisions input through dataflow read-after-write
dataflow writes → semantics.reduce(PROCESS/DATA) input
DataflowOutput serialization/deserialization → semantics.reduce input
```

---

## 23. Examples

### 23.1. Happy path: payload → facts → decisions

See example in [6. Source dataflow artifact](#6-source-dataflow-artifact).

### 23.2. schemaRef variant

```json
{
  "id": "dataflow.abs.evaluate_resolution",
  "version": "1.0.0",
  "title": "Оценка клиента в АБС",
  "schemaRef": "schema.abs.evaluate_resolution",
  "pipeline": [
    {
      "id": "derive_comparison_facts",
      "type": "MAPPINGS",
      "kind": "facts",
      "artefactId": "mappings.abs.client_comparison_facts",
      "contract": {
        "input": { "ref": "$.context.data.payloads.clientComparison" },
        "output": { "ref": "$.context.data.facts.clientComparison" }
      }
    }
  ]
}
```

### 23.3. Invalid artifact: both schema and schemaRef

```json
{
  "id": "dataflow.invalid",
  "version": "1.0.0",
  "schema": {},
  "schemaRef": "schema.some",
  "pipeline": []
}
```

Expected diagnostics:

```json
{
  "ok": false,
  "diagnostics": [
    {
      "code": "DATAFLOW_SCHEMA_AMBIGUOUS",
      "level": "error",
      "message": "Exactly one of schema or schemaRef must be present."
    },
    {
      "code": "DATAFLOW_PIPELINE_EMPTY",
      "level": "error",
      "message": "Dataflow pipeline must contain at least one item."
    }
  ]
}
```

### 23.4. Compile failure

```ts
try {
  prepareDataflow(invalidSource);
} catch (error) {
  if (error instanceof DataflowCompileError) {
    console.log(error.diagnostics);
  }
}
```

### 23.5. Prepared artifact shape

```json
{
  "artifactType": "dataflow",
  "id": "dataflow.abs.evaluate_resolution",
  "version": "1.0.0",
  "schema": {
    "$.context.data.facts.clientComparison": { "title": "Факты по клиенту", "description": "Факты, используемые для выбора сценария обработки клиента.", "fields": {} }
  },
  "readSet": ["$.context.data.payloads.clientComparison"],
  "writeSet": ["$.context.data.facts.clientComparison"],
  "items": [
    {
      "id": "derive_comparison_facts",
      "type": "MAPPINGS",
      "kind": "facts",
      "artefactId": "mappings.abs.client_comparison_facts",
      "contract": {
        "input": { "ref": "$.context.data.payloads.clientComparison" },
        "output": { "ref": "$.context.data.facts.clientComparison" }
      }
    }
  ]
}
```

### 23.6. Runtime output

```json
{
  "writes": [
    {
      "ref": "$.context.data.facts.clientComparison",
      "itemId": "derive_comparison_facts",
      "value": {
        "hasCriticalMismatches": false,
        "clientOriginKind": "ABS_EXISTING"
      }
    }
  ]
}
```

### 23.7. Verbose trace

```json
{
  "kind": "DATAFLOW_ITEM_COMPLETED",
  "artifactType": "dataflow",
  "artifactId": "dataflow.abs.evaluate_resolution",
  "step": {
    "id": "derive_comparison_facts",
    "type": "MAPPINGS",
    "artefactId": "mappings.abs.client_comparison_facts"
  },
  "at": "2026-05-17T10:00:00.000Z",
  "outcome": "completed",
  "details": {
    "inputRef": "$.context.data.payloads.clientComparison",
    "outputRef": "$.context.data.facts.clientComparison"
  }
}
```

---

## 24. Compatibility

Public compatibility surface:

- public API names and signatures;
- `DataflowSource` format;
- public `DataflowArtifact` shape;
- `DataflowOutput` shape;
- `DataflowWrite` shape;
- diagnostics codes;
- runtime error codes;
- trace shape per mode;
- schema/schemaRef rules;
- PathRef rules;
- JSON-safe guarantees.

Breaking changes include:

- changing source artifact required fields;
- changing item type semantics;
- changing `DataflowOutput` shape;
- changing write atomicity semantics;
- changing `read-after-write` semantics;
- removing diagnostic/error codes;
- changing basic trace shape incompatibly;
- weakening transport-safe guarantees.

---

## 25. Migration

`@processengine/dataflows` v2 is introduced as part of Flow 5 hard breaking model.

Migration from Flow3 process artifacts is a rewrite:

```text
PROCESS/MAPPINGS / PROCESS/RULES / PROCESS/DECISIONS chains
  → PROCESS/DATA + dataflow artifact

context.facts.*
  → context.data.facts.*

context.decisions.*
  → context.data.decisions.*

context.checks.*
  → context.data.checks.*

result mappings
  → context.data.results.*
```

Mapping artifacts must be updated to `@processengine/mappings` v3 with required `kind`.

---

## 26. Testing, CI и release readiness

Definition of done for package changes:

```text
npm test
npm run test:pack
npm pack
pack/install smoke
ESM import smoke
type exports smoke
```

If CLI is added later:

```text
CLI smoke tests must verify commands used in CI.
```

CI checks must verify:

- `.github/workflows/*.yml` актуальны;
- Node.js matrix matches `engines.node`;
- package-lock is consistent with `npm ci`;
- exports map matches built package;
- dist/types are included in npm package;
- examples import package as installed package, not from `src/`.

Required test categories:

```text
unit tests
contract tests
trace tests
transport-safe tests
interop tests
pack/install tests
```

Required interop/contract tests:

```text
rules result → dataflow pipeline item
dataflow MAPPINGS output → dataflow DECISIONS input
dataflow writes → semantics.reduce(PROCESS/DATA)
DataflowOutput JSON serialization/deserialization → semantics.reduce
```

Release readiness requires:

- README updated;
- SPEC updated;
- COMPATIBILITY updated;
- MIGRATION updated if breaking;
- CHANGELOG updated;
- package version bumped through release process;
- Git tag / GitHub Release / npm publication workflow green.

---

## 27. Acceptance criteria

### 27.1. API

- `validateDataflow` returns `{ ok, diagnostics }` and does not throw on invalid source.
- `prepareDataflow` throws `DataflowCompileError` on invalid source.
- `executeDataflow` accepts only prepared `DataflowArtifact`.
- `executeDataflow` returns `DataflowOutput` only on success.
- Runtime failures throw `DataflowRuntimeError`.

### 27.2. Validation

- Missing schema produces diagnostic.
- Both `schema` and `schemaRef` produces diagnostic.
- Empty pipeline produces diagnostic.
- Unsupported item type produces diagnostic.
- Duplicate item id produces diagnostic.
- Duplicate output ref produces diagnostic.
- In-place read/write produces diagnostic.
- Output ref outside `$.context.data.*` produces diagnostic.
- Output ref not in schema produces diagnostic.
- Dynamic refs produce diagnostic.

### 27.3. Prepare

- Resolves schemaRef.
- Produces `DataflowArtifact` with `artifactType: 'dataflow'`.
- Produces `readSet` and `writeSet`.
- Prepared artifact is JSON-safe and serializable.
- Runtime does not mutate prepared artifact.

### 27.4. Runtime

- Executes items in order.
- Dispatches through `executeMappings`, `evaluateRules`, `evaluateDecisions` wrappers.
- Supports read-after-write.
- Does not mutate original state.
- Returns explicit `writes[]`.
- Does not return partial writes on failure.
- Throws if item output is not JSON-safe.
- Optional runtime schema validation works within the documented v2 minimal field-type assertion limits.

### 27.5. Trace

- `trace='off'` omits trace.
- `trace='basic'` returns safe events without raw values.
- `trace='verbose'` may include input/output subject to redaction.
- Trace event contains `step`.

### 27.6. Interop

- `rules result → dataflow` works without host cleanup.
- `mappings output → decisions input` works through dataflow without host cleanup.
- `DataflowOutput → semantics.reduce(PROCESS/DATA)` works without host cleanup.
- Runtime result survives JSON serialization/deserialization.



### 23.9. Example files

The package includes an `examples/` directory with normative examples:

- `happy-path.json`;
- `failing-path-missing-input.json`;
- `interop-read-after-write.json`.

These examples are included in the npm tarball and must remain aligned with README, SPEC and tests.

### Runtime result contract clarification

Runtime modules called by `@processengine/dataflows` MUST return canonical runtime result objects of shape `{ output: JsonValue, trace?: JsonValue[] }`. Bare values are invalid and MUST produce `DATAFLOW_RUNTIME_RESULT_INVALID`. This avoids ambiguity when a valid business object itself contains an `output` field. Child runtime `trace` is accepted for interop with family runtimes but is not merged into `DataflowOutput.trace` in v2; dataflow trace records only dataflow item execution.
