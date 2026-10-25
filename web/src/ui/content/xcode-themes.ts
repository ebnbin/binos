import type { ThemeRegistration } from 'shiki/core'

// 代码高亮的配色，取 Xcode 的 Default (Light) / Default (Dark)：关键字粉色加粗、字符串红、数字蓝（深色是黄）、
// 声明的名字蓝、类型紫、注释灰。普通文字用界面的 label 颜色，跟随深浅色
type Palette = {
  keyword: string
  string: string
  character: string
  number: string
  comment: string
  declaration: string
  type: string
  function: string
  property: string
  preprocessor: string
  attribute: string
  url: string
}

const light: Palette = {
  keyword: '#9b2393',
  string: '#c41a16',
  character: '#1c00cf',
  number: '#1c00cf',
  comment: '#5d6c79',
  declaration: '#0f68a0',
  type: '#3900a0',
  function: '#6c36a9',
  property: '#326d74',
  preprocessor: '#643820',
  attribute: '#815f03',
  url: '#0e0eff',
}

const dark: Palette = {
  keyword: '#ff7ab2',
  string: '#ff8170',
  character: '#d9c97c',
  number: '#d9c97c',
  comment: '#7f8c98',
  declaration: '#4eb0cc',
  type: '#dabaff',
  function: '#b281eb',
  property: '#67b7a4',
  preprocessor: '#fd8f3f',
  attribute: '#cc9768',
  url: '#6699ff',
}

function theme(name: string, type: 'light' | 'dark', c: Palette): ThemeRegistration {
  return {
    name,
    type,
    colors: { 'editor.foreground': 'var(--color-label)', 'editor.background': 'var(--color-background-secondary)' },
    tokenColors: [
      { scope: ['comment', 'punctuation.definition.comment', 'string.comment'], settings: { foreground: c.comment } },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'constant.language',
          'variable.language',
          'keyword.operator.new',
          'keyword.operator.expression',
          'keyword.operator.logical.python',
          'support.type.primitive',
          'support.type.builtin',
        ],
        settings: { foreground: c.keyword, fontStyle: 'bold' },
      },
      { scope: ['keyword.operator', 'punctuation'], settings: { foreground: 'var(--color-label)', fontStyle: '' } },
      { scope: ['string', 'string.template', 'punctuation.definition.string'], settings: { foreground: c.string } },
      { scope: ['constant.character', 'constant.character.escape', 'string.regexp'], settings: { foreground: c.character } },
      { scope: ['constant.numeric', 'constant.other', 'support.constant'], settings: { foreground: c.number } },
      {
        scope: ['entity.name.function', 'entity.name.type', 'entity.name.class', 'entity.name.namespace', 'entity.name.section', 'meta.definition.variable'],
        settings: { foreground: c.declaration },
      },
      {
        scope: ['entity.name.type.class', 'support.type', 'support.class', 'entity.other.inherited-class', 'meta.type.annotation entity.name.type'],
        settings: { foreground: c.type },
      },
      { scope: ['meta.function-call entity.name.function', 'support.function', 'variable.function'], settings: { foreground: c.function } },
      { scope: ['variable.other.property', 'variable.other.object.property', 'support.variable.property', 'meta.object-literal.key'], settings: { foreground: c.property } },
      {
        scope: ['meta.preprocessor', 'keyword.control.directive', 'punctuation.definition.directive', 'meta.decorator', 'entity.name.function.decorator', 'storage.type.annotation'],
        settings: { foreground: c.preprocessor },
      },
      { scope: ['entity.name.tag', 'support.type.property-name', 'support.type.property-name.json'], settings: { foreground: c.declaration } },
      { scope: ['entity.other.attribute-name'], settings: { foreground: c.attribute } },
      { scope: ['markup.underline.link', 'string.other.link'], settings: { foreground: c.url } },
      { scope: ['markup.heading', 'markup.heading entity.name'], settings: { foreground: c.keyword, fontStyle: 'bold' } },
      { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
      { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
      { scope: ['markup.inline.raw', 'markup.fenced_code'], settings: { foreground: c.string } },
      { scope: ['markup.inserted'], settings: { foreground: 'var(--color-success-text)' } },
      { scope: ['markup.deleted'], settings: { foreground: 'var(--color-destructive-text)' } },
      { scope: ['meta.diff.header', 'meta.diff.range'], settings: { foreground: c.comment } },
    ],
  }
}

export const xcodeLight = theme('xcode-light', 'light', light)
export const xcodeDark = theme('xcode-dark', 'dark', dark)
