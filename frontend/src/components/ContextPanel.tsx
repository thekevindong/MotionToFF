import { useRef } from 'react'

const CONTEXT_FILE_ACCEPT = '.pdf,.docx,.txt'

export function ContextPanel({
  jobTitle,
  onJobTitleChange,
  files,
  onAddFiles,
  onRemoveFile,
  disabled,
}: {
  jobTitle: string
  onJobTitleChange: (value: string) => void
  files: File[]
  onAddFiles: (picked: FileList | null) => void
  onRemoveFile: (index: number) => void
  disabled?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="context-panel" aria-label="Session context">
      <p className="context-caption">
        Optional role title and resume or job description for sharper questions. You can skip this step and add
        nothing.
      </p>
      <label className="context-field">
        <span className="context-field-label">Target role</span>
        <input
          type="text"
          className="context-input"
          placeholder="e.g. Software engineer, new grad"
          value={jobTitle}
          onChange={(e) => onJobTitleChange(e.target.value)}
          disabled={disabled}
        />
      </label>
      <div className="context-files">
        <span className="context-field-label">Documents</span>
        <button
          type="button"
          className="context-upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
        >
          Upload PDF, DOCX, or TXT
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="context-file-input"
          accept={CONTEXT_FILE_ACCEPT}
          multiple
          onChange={(e) => {
            onAddFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {files.length > 0 && (
          <ul className="context-file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`}>
                <span className="context-file-name">{file.name}</span>
                <button
                  type="button"
                  className="context-file-remove"
                  onClick={() => onRemoveFile(index)}
                  disabled={disabled}
                  aria-label={`Remove ${file.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
