import { characterPortraitUrl } from './character-expressions'

export type Mode = {
  id: string
  title: string
  desc: string
  ready: boolean
}

export type Character = {
  id: 'recruiter' | 'manager' | 'hr'
  name: string
  role: string
  tone: string
  desc: string
  img: string
}

export const MODES: Mode[] = [
  { id: 'salary', title: 'Salary Negotiation', desc: 'Defend your number under pressure.', ready: true },
  { id: 'interview', title: 'Mock Interview', desc: 'Behavioral and role-fit questions.', ready: false },
  { id: 'speaking', title: 'Public Speaking', desc: 'Own the room, steady your nerves.', ready: false },
  { id: 'thesis', title: 'Thesis Defense', desc: 'Field hard questions on your work.', ready: false },
]

export const SALARY_CHARACTERS: Character[] = [
  {
    id: 'recruiter',
    name: 'University Recruiter',
    role: 'Early-career hiring',
    tone: 'Polite',
    desc: 'Warm and encouraging. Eases you into the conversation and roots for you.',
    img: characterPortraitUrl('recruiter'),
  },
  {
    id: 'manager',
    name: 'Senior Manager',
    role: 'Hiring manager',
    tone: 'Formal',
    desc: 'Measured and professional. Expects structure and clear reasoning behind your number.',
    img: characterPortraitUrl('manager'),
  },
  {
    id: 'hr',
    name: 'HR Lead',
    role: 'Compensation & policy',
    tone: 'Firm',
    desc: 'Direct and policy-led. Holds the line on bands and asks for a defensible case.',
    img: characterPortraitUrl('hr'),
  },
]
