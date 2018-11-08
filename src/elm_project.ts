import _ from 'lodash'
import * as T from './types'
import * as Path from 'path'
import * as Fs from 'fs'
import * as Os from 'os'
import FastGlob from 'fast-glob'
import { Module, parseElmModule } from 'elm-module-parser'

/**
 * Provides information for any number of Elm projects under the provided workspace directories.
 * Maintains a cache of parsed modules which can be invalidated to force reprocessing a Module.
 */
export class ElmProjectManager {
   private projects: T.ElmProjectDefinition[] = []

   private cache: {
      [module_path: string]: {
         parsed: Module
         module_name: string
         module_path: string
      }
   } = {}

   constructor(private workspace_paths: string[]) {}

   /**
    * Parses and provides information about a module given a starting path.
    *
    * @param contextual_path The path to be used to locate the Elm project.
    * @param module_name The name of the module.
    * @returns Module details or `null` if module does not exist or fails to parse.
    */
   public async moduleFromName(contextual_path: string, module_name: string): Promise<Module | null> {
      const elm_project = await this.projectDefinitionForPath(contextual_path)

      if (_.isNil(elm_project)) {
         return null
      }

      const possible_paths = this.moduleNameToPaths(elm_project, module_name)

      for (const path of possible_paths) {
         const module = await this.moduleFromPath(path)

         if (!_.isNil(module)) {
            return module
         }
      }

      return null
   }

   /**
    * Parses and provides information about a module at a given path.
    *
    * @param module_path The path to the module including extension
    * @returns Module details or `null` if file does not exist or fails to parse.
    */
   public async moduleFromPath(module_path: string): Promise<Module | null> {
      if (this.cache[module_path]) {
         return this.cache[module_path].parsed
      }

      const module_text = await this.readFileOrNull(module_path)

      if (_.isNil(module_text)) {
         return null
      }

      try {
         const parsed_module = parseElmModule(module_text)

         this.cache[module_path] = {
            module_path: module_path,
            module_name: parsed_module.name,
            parsed: parsed_module,
         }

         return parsed_module
      } catch (error) {
         return null
      }
   }

   /**
    * Documentation for an item in an Elm module.
    *
    * @param contextual_path The path to locate the closest elm project in the workspace.
    * @param module_name The fully specified module name.
    * @param path The name of a type or value.
    */
   public async docs(contextual_path: string, module_name: string, path: string): Promise<any> {
      const elm_project = await this.projectDefinitionForPath(contextual_path)

      if (_.isNil(elm_project)) {
         return null
      }

      const documentation = _(elm_project.dependencies)
         .flatMap(dep => {
            if (!_.includes(dep.exposed_modules, module_name)) {
               return []
            }

            return _.compact(
               dep.documentation
                  .filter((doc: any) => doc.name === module_name)
                  .map((doc: any) => _.find(doc.values, v => v.name === path))
            )
         })
         .first()

      return documentation
   }

   /**
    * Removes cache entries for a path.
    *
    * @param path The path to invalidate.
    */
   public invalidatePath(path: string): ElmProjectManager {
      delete this.cache[path]
      return this
   }

   /**
    * Locate an Elm Project Definition given a path.
    *
    * @param contextual_path The path to locate the closest elm project in the workspace.
    * @returns If no project is in a parent directory of `contextual_path` then `null` is returned.
    */
   public async projectDefinitionForPath(contextual_path: string): Promise<T.ElmProjectDefinition | null> {
      if (_.isEmpty(this.projects)) {
         this.projects = await this.loadElmProjects()
      }

      const probable_project = this.projects.find(x => !_.isNil(x.source_dirs.find(d => contextual_path.startsWith(d))))

      if (_.isNil(probable_project)) {
         return null
      }

      return probable_project
   }

   private async readFileOrNull(document_path: string): Promise<string | null> {
      try {
         return await new Promise<string>((resolve, reject) => {
            Fs.readFile(document_path, (err, data) => {
               if (err) {
                  return reject(err)
               } else {
                  return resolve(data.toString('utf-8'))
               }
            })
         })
      } catch (error) {
         return null
      }
   }

   private async loadElmProjects(): Promise<T.ElmProjectDefinition[]> {
      const elm_project_entries = (await FastGlob(
         this.workspace_paths
            .map(p => Path.join(p, '**/elm.json'))
            .concat(this.workspace_paths.map(p => Path.join(p, '**/elm-package.json')))
            .concat('!**/node_modules/**')
            .concat('!**/elm-stuff/**')
      )) as string[]

      if (_.isEmpty(elm_project_entries)) {
         return []
      } else {
         const projects = await Promise.all(
            elm_project_entries.map(async project_entry => {
               try {
                  const elm_project_doc = await this.readFileOrNull(project_entry)

                  if (_.isNil(elm_project_doc)) {
                     return null
                  }

                  const elm_project_json = JSON.parse(elm_project_doc)
                  const direct_dependencies = _.get(elm_project_json, 'dependencies.direct', [])

                  const dependencies = await Promise.all(
                     _.keys(direct_dependencies).map(async pkg => {
                        const elm_dependencies_dir =
                           process.platform === 'win32'
                              ? Path.join(process.env['AppData']!, 'elm')
                              : Path.join(Os.homedir(), `.elm/${elm_project_json['elm-version']}/package`)

                        const package_path = Path.join(elm_dependencies_dir, pkg, direct_dependencies[pkg])

                        const documentation = JSON.parse(
                           (await this.readFileOrNull(Path.join(package_path, 'documentation.json')))!
                        )

                        return {
                           name: pkg,
                           version: direct_dependencies[pkg],
                           package_path: package_path,
                           exposed_modules: documentation.map((x: { name: string }) => x.name),
                           documentation: documentation,
                        }
                     })
                  )

                  return {
                     project_type: <'application'>'application',
                     path: project_entry,
                     version: elm_project_json['elm-version'],
                     source_dirs: elm_project_json['source-directories'].map((d: string) =>
                        Path.join(Path.dirname(project_entry), d)
                     ),
                     dependencies: dependencies,
                     json: elm_project_json,
                  }
               } catch (error) {
                  return null
               }
            })
         )

         return _.compact(projects)
      }
   }

   private moduleNameToPaths(elm_project: T.ElmProjectDefinition, module_name: string): string[] {
      const module_relative_path = `${module_name.replace(/[.]/g, Path.sep)}.elm`

      return elm_project.source_dirs
         .map(d => Path.join(d, module_relative_path))
         .concat(elm_project.dependencies.map(d => Path.join(d.package_path, 'src', module_relative_path)))
   }
}
