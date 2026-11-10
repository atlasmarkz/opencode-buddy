// Shared IPC contract between the GUI window and the Electron main process.
// Keep this file free of Node imports: it is bundled into both sides.
import { Ipc } from "@opencode/plugin/gui"
import { Schema } from "effect"

export const BuddyIpc = Ipc.define({
  id: "opencode-buddy.state",
  methods: {
    get: {
      input: Schema.Struct({ sessionID: Schema.String }),
      output: Schema.Unknown,
    },
    mutate: {
      input: Schema.Struct({
        sessionID: Schema.String,
        action: Schema.String,
        value: Schema.optionalKey(Schema.String),
      }),
      output: Schema.Unknown,
    },
    list: {
      output: Schema.Unknown,
    },
    packs: {
      output: Schema.Unknown,
    },
    pack: {
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Unknown,
    },
    selectPet: {
      input: Schema.Struct({ id: Schema.optionalKey(Schema.String) }),
      output: Schema.Unknown,
    },
  },
})
