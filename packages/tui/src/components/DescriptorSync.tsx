// Drains the (possibly async) descriptor list into DaemonsContext when
// config discovery resolves. Pure side-effect — renders nothing.

import { useEffect } from "react"

import { useDaemons } from "../state/daemons-context.tsx"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

export function DescriptorSync({
  descriptors,
}: {
  descriptors: DaemonDescriptor[]
}): null {
  const { syncDescriptors } = useDaemons()
  useEffect(() => {
    syncDescriptors(descriptors)
  }, [descriptors, syncDescriptors])
  return null
}
