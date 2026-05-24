interface Props {
  password: string;
}

interface StrengthResult {
  score: number; // 0-4
  label: string;
  colour: string;
}

function evaluate(password: string): StrengthResult {
  if (!password) return { score: 0, label: '', colour: 'bg-gray-200' };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 14) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  // Map to 0-4
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;

  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  const colours = [
    'bg-red-400',
    'bg-orange-400',
    'bg-yellow-400',
    'bg-blue-400',
    'bg-green-500',
  ];

  return {
    score: clamped,
    label: labels[clamped]!,
    colour: colours[clamped]!,
  };
}

/**
 * Visual password strength indicator — 4 segmented bars.
 */
export function PasswordStrength({ password }: Props) {
  if (!password) return null;

  const { score, label, colour } = evaluate(password);

  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score ? colour : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <p className={`mt-0.5 text-xs ${score <= 1 ? 'text-red-600' : score <= 2 ? 'text-yellow-600' : 'text-green-700'}`}>
        {label}
      </p>
    </div>
  );
}
