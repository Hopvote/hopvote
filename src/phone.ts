// Phone numbers as people type them, checked the same way on the phone and in the room:
// +33 6 12 34 56 78, (555) 123-4567 ext 12, 0171/1234567.
export const PHONE = /^\+?[0-9 ().\/-]{6,30}( ?(ext|x)\.? ?[0-9]{1,6})?$/i;
