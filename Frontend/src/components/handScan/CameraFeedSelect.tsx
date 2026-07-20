type CameraFeedSelectProps = {
  label: string
  value: string
  devices: MediaDeviceInfo[]
  onChange: (deviceId: string) => void
}

export function CameraFeedSelect({ label, value, devices, onChange }: CameraFeedSelectProps) {
  return (
    <div className="hand-scan-fs__feed-select-wrap">
      <label className="hand-scan-fs__feed-select-label">
        <span className="hand-scan-fs__feed-select-name">{label}</span>
        <span className="hand-scan-fs__feed-select-inner">
          <select
            className="hand-scan-fs__feed-select"
            value={value}
            aria-label={`${label} 선택`}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="default">기본 카메라</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `카메라 ${index + 1}`}
              </option>
            ))}
          </select>
          <svg
            className="hand-scan-fs__feed-select-chevron"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </label>
    </div>
  )
}
