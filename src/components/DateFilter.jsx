// DateFilter — segmented control over the date-range options. Thin wrapper
// over the ToggleGroup primitive so visual changes (border/padding/active
// state) ripple through every segmented control in the app from one place.

import { ToggleGroup } from './ui/ToggleGroup';

const OPTIONS = [
  { value: '1h',  label: '1h'  },
  { value: '24h', label: '24h' },
  { value: 7,     label: '7d'  },
  { value: 30,    label: '30d' },
  { value: 90,    label: '90d' },
  { value: 'all', label: 'All' },
];

export default function DateFilter({ value, onChange }) {
  return (
    <ToggleGroup
      value={value}
      onChange={onChange}
      options={OPTIONS}
      size="md"
      ariaLabel="Date range"
    />
  );
}
