"use client";
import { objectToFormData } from "@davstack/action";
import { uploadFile } from "./file.action";
export interface FilePageProps {}

export default function FilePage(props: FilePageProps) {
  const {} = props;

  return (
    <>
      <form action={uploadFile as any}>
        <input type="file" name="file" />
        <button type="submit">Upload via form action</button>
      </form>

      <button
        onClick={async () => {
          try {
            const file = new Blob([], { type: "123" });
            await uploadFile(objectToFormData({ file }));
          } catch (e) {
            console.error(e);
          }
        }}
      >
        upload via direct action call
      </button>
    </>
  );
}
