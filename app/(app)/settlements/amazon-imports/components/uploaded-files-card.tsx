import { shortDate } from "@/lib/format";
import type { AmazonSourceFileView } from "@/lib/amazon-statements/server/ui-read-service";
import AmazonImportStatusBadge from "./amazon-import-status-badge";

function bytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export default function UploadedFilesCard({ files }: { files: AmazonSourceFileView[] }) {
  return (
    <section className="card overflow-x-auto p-0">
      <h2 className="p-4 font-semibold">Verified file status</h2>
      <table className="w-full min-w-[760px]">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Source</th>
            <th className="th">File</th>
            <th className="th text-right">Size</th>
            <th className="th">Upload / parse</th>
            <th className="th">Parser</th>
            <th className="th">Schema</th>
            <th className="th text-right">Issues</th>
            <th className="th">Uploaded</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {files.length === 0 ? (
            <tr><td className="td text-slate-400" colSpan={8}>No files uploaded yet.</td></tr>
          ) : files.map((file) => (
            <tr key={file.id}>
              <td className="td">{file.label}</td>
              <td className="td">{file.sanitizedFilename}</td>
              <td className="td text-right">{bytes(file.verifiedSizeBytes)}</td>
              <td className="td"><AmazonImportStatusBadge status={file.status} /></td>
              <td className="td">{file.parserName ? `${file.parserName} ${file.parserVersion ?? ""}` : "Not inspected"}</td>
              <td className="td"><AmazonImportStatusBadge status={file.schemaStatus} /></td>
              <td className="td text-right">
                <span className="text-red-700">{file.blockingCount}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-amber-700">{file.warningCount}</span>
              </td>
              <td className="td">{shortDate(file.uploadedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
