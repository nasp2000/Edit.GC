'use strict';
// ---- Safe array min/max (avoids "Maximum call stack size exceeded" on large arrays) ----
function safeMin(arr) { let m = arr[0]; for (let i = 1; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; }
function safeMax(arr) { let m = arr[0]; for (let i = 1; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }
function safeMinMax(arr) { let mn = arr[0], mx = arr[0]; for (let i = 1; i < arr.length; i++) { if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx) mx = arr[i]; } return { min: mn, max: mx }; }
