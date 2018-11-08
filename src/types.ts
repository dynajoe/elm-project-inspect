export interface ElmProjectDefinition {
   json: any
   project_type: 'application' | 'package'
   path: string
   version: string
   source_dirs: string[]
   dependencies: {
      name: string
      exposed_modules: string[]
      version: string
      package_path: string
      documentation: any
   }[]
}

export type CompletionContext = 'function' | 'import' | 'type' | 'module'

export type CompletionItemKind = 'value' | 'type' | 'module'

export class ElmCompletionItem {
   detail: string
   documentation: string
   constructor(
      public label: string,
      public kind: CompletionItemKind,
      public contextual_path: string,
      public module: string,
      public name: string
   ) {}
}
