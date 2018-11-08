import _ from 'lodash'
import * as T from './types'
import { ModuleImport, exposedOnlyView } from 'elm-module-parser'
import { ElmProjectManager } from './elm_project'
import { getMatchUpToPosition } from './util'

export async function provideCompletionItems(
   elm_project_manager: ElmProjectManager,
   document_path: string,
   offset: number
): Promise<T.ElmCompletionItem[]> {
   elm_project_manager.invalidatePath(document_path)

   const elm_module = await elm_project_manager.moduleFromPath(document_path)

   const word_range = getMatchUpToPosition(elm_module.text, offset, /[A-Za-z0-9_+-/*=.<>:&|^?%!]+/)

   if (_.isEmpty(word_range)) {
      return []
   }

   if (_.isNil(elm_module)) {
      return []
   }

   const { context, text, prefix } = determineContext(elm_module.text, offset)

   const possible_imports = _.filter(
      elm_module.imports,
      (i: ModuleImport): boolean => {
         const match_text = _.isEmpty(prefix) ? text : prefix
         return i.module.startsWith(match_text) || (i.alias || '').startsWith(_.isEmpty(prefix) ? text : prefix)
      }
   )

   const import_views = _.compact(
      await Promise.all(
         possible_imports.map(async i => {
            const m = await elm_project_manager.moduleFromName(document_path, i.module)

            if (_.isNil(m)) {
               return null
            }

            return {
               import: i,
               module: m,
               view: exposedOnlyView(m),
            }
         })
      )
   )

   if (context === 'function') {
      return _.concat(
         elm_module.function_declarations.map(d => {
            return new T.ElmCompletionItem(d.name, 'value', document_path, elm_module.name, d.name)
         }),
         _.flatMap(import_views, v => {
            return v.view.functions.map(f => {
               return new T.ElmCompletionItem(f.name, 'value', document_path, v.module.name, f.name)
            })
         }),
         _.flatMap(import_views, i => {
            return _.flatMap(i.view.custom_types, t => {
               return t.constructors.map(
                  c => new T.ElmCompletionItem(c.name, 'module', document_path, i.module.name, c.name)
               )
            })
         })
      )
   } else if (context === 'module') {
      return _(import_views)
         .flatMap(view => {
            const completion_parts = _(view.view.name.split(/[.]/g))
               .zipWith(prefix.split(/[.]/g))
               .takeRightWhile(([a, b]) => a !== b)
               .map(([a]) => a)
               .value()

            return _.compact(
               [
                  _.isEmpty(completion_parts)
                     ? null
                     : new T.ElmCompletionItem(
                          completion_parts.join('.'),
                          'module',
                          document_path,
                          view.module.name,
                          view.view.name
                       ),
               ].concat(
                  view.module.name === prefix || view.import.alias === prefix
                     ? view.view.functions.map(t => {
                          return new T.ElmCompletionItem(t.name, 'value', document_path, view.module.name, t.name)
                       })
                     : null
               )
            )
         })
         .value()
   }

   return []
}

export async function resolveCompletionItem(
   elm_project_manager: ElmProjectManager,
   completion_item: T.ElmCompletionItem
): Promise<T.ElmCompletionItem> {
   const docs = await elm_project_manager.docs(
      completion_item.contextual_path,
      completion_item.module,
      completion_item.name
   )

   completion_item.detail = _.isNil(docs) ? '' : `${docs['name']} : ${docs['type']}`
   completion_item.documentation = _.isNil(docs) ? '' : `${docs['comment']}`

   return completion_item
}

function determineContext(
   text: string,
   offset: number
): { context: T.CompletionContext; prefix: string; text: string } {
   const match = getMatchUpToPosition(text, offset, /[A-Za-z0-9_.]+/)

   const current_word = match.substring(match.lastIndexOf('.') + 1)
   const prefix = match.substring(0, match.lastIndexOf('.'))

   if (prefix !== '' || current_word[0].match(/[A-Z]/)) {
      return { context: 'module', prefix: prefix.trim(), text: current_word.trim() }
   }

   return { context: 'function', prefix: '', text: current_word.trim() }
}
