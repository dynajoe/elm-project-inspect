import _ from 'lodash'

export function getMatchUpToPosition(text: string, offset: number, regex: RegExp): string {
   const match = text.substring(0, offset).match(new RegExp(`(${regex.source})\$`))

   if (_.isNil(match)) {
      return ''
   }

   return match[1]
}
