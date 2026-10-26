/**
 * DSA practice problems (demo content, provenance = DEMO).
 *
 * Each problem is a typed function signature plus JSON test cases. Starter
 * code and the judge's harness for every language are generated from the
 * signature by the backend, so nothing here is language-specific.
 *
 * `tests` are public (shown to students, used by "Run").
 * `hidden` are used only by "Submit" and never leave the server.
 */

export interface DsaProblemSeed {
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  tags: string[];
  companies: string[];
  description: string;
  constraints: string[];
  functionName: string;
  /** [name, type] pairs, in call order. */
  params: Array<[string, string]>;
  returns: string;
  compare?: 'exact' | 'unordered' | 'unorderedNested';
  tests: Array<{ args: unknown[]; expected: unknown; explanation?: string }>;
  hidden: Array<{ args: unknown[]; expected: unknown }>;
  hints: string[];
  timeLimitMs?: number;
  memoryLimitMb?: number;
}

const t = (args: unknown[], expected: unknown, explanation?: string) => ({ args, expected, explanation });

export const DSA_PROBLEMS: DsaProblemSeed[] = [
  {
    title: 'Two Sum',
    difficulty: 'EASY',
    tags: ['Arrays', 'Hashing'],
    companies: ['Amazon', 'Zoho', 'Cognizant'],
    description:
      'Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.\n\n'
      + 'Each input has exactly one solution, and you may not use the same element twice. You can return the two indices in any order.',
    constraints: ['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', '-10^9 <= target <= 10^9', 'Exactly one valid answer exists.'],
    functionName: 'twoSum',
    params: [['nums', 'int[]'], ['target', 'int']],
    returns: 'int[]',
    compare: 'unordered',
    tests: [
      t([[2, 7, 11, 15], 9], [0, 1], 'nums[0] + nums[1] = 2 + 7 = 9.'),
      t([[3, 2, 4], 6], [1, 2], 'nums[1] + nums[2] = 2 + 4 = 6.'),
      t([[3, 3], 6], [0, 1]),
    ],
    hidden: [
      t([[-3, 4, -5, 7, 1], -8], [0, 2]),
      t([[1, 5, 9, 14, 20], 34], [3, 4]),
      t([[0, 4, 3, 0], 0], [0, 3]),
      t([[-1, -2, -3, -4, -5], -8], [2, 4]),
      t([[1000000000, 3, -1000000000, 8], 11], [1, 3]),
    ],
    hints: ['Checking every pair works but takes O(n^2).', 'Store each value with its index in a hash map and look up target - value as you go.'],
  },
  {
    title: 'Best Time to Buy and Sell Stock',
    difficulty: 'EASY',
    tags: ['Arrays', 'Greedy'],
    companies: ['Amazon', 'TCS', 'Infosys'],
    description:
      'You are given an array prices where prices[i] is the price of a stock on day i.\n\n'
      + 'Choose one day to buy and a later day to sell. Return the maximum profit you can make. If no profit is possible, return 0.',
    constraints: ['1 <= prices.length <= 10^5', '0 <= prices[i] <= 10^4'],
    functionName: 'maxProfit',
    params: [['prices', 'int[]']],
    returns: 'int',
    tests: [
      t([[7, 1, 5, 3, 6, 4]], 5, 'Buy at 1 (day 1) and sell at 6 (day 4).'),
      t([[7, 6, 4, 3, 1]], 0, 'Prices only fall, so no trade is made.'),
      t([[2, 4, 1]], 2),
    ],
    hidden: [t([[1]], 0), t([[1, 2]], 1), t([[3, 3, 3, 3]], 0), t([[2, 1, 2, 1, 0, 1, 2]], 2), t([[9, 1, 10, 2, 11]], 10)],
    hints: ['Track the lowest price seen so far.', 'At each day, the best sale is today\'s price minus that lowest price.'],
  },
  {
    title: 'Valid Anagram',
    difficulty: 'EASY',
    tags: ['Strings', 'Hashing', 'Sorting'],
    companies: ['Wipro', 'Accenture', 'Zoho'],
    description: 'Given two strings s and t, return true if t is an anagram of s, and false otherwise.\n\nAn anagram uses exactly the same letters the same number of times, in any order.',
    constraints: ['1 <= s.length, t.length <= 5 * 10^4', 's and t consist of lowercase English letters.'],
    functionName: 'isAnagram',
    params: [['s', 'string'], ['t', 'string']],
    returns: 'bool',
    tests: [t(['anagram', 'nagaram'], true), t(['rat', 'car'], false), t(['a', 'a'], true)],
    hidden: [t(['ab', 'a'], false), t(['aacc', 'ccac'], false), t(['listen', 'silent'], true), t(['abcabc', 'aabbcc'], true), t(['aab', 'abb'], false)],
    hints: ['Different lengths can never be anagrams.', 'Count the letters of one string and subtract the letters of the other.'],
  },
  {
    title: 'Valid Palindrome',
    difficulty: 'EASY',
    tags: ['Strings', 'Two Pointers'],
    companies: ['TCS', 'Capgemini', 'Microsoft'],
    description:
      'A phrase is a palindrome if, after converting all uppercase letters to lowercase and removing every character that is not a letter or digit, it reads the same forward and backward.\n\n'
      + 'Given a string s, return true if it is a palindrome, and false otherwise.',
    constraints: ['1 <= s.length <= 2 * 10^5', 's consists of printable ASCII characters.'],
    functionName: 'isPalindrome',
    params: [['s', 'string']],
    returns: 'bool',
    tests: [
      t(['A man, a plan, a canal: Panama'], true, '"amanaplanacanalpanama" is a palindrome.'),
      t(['race a car'], false, '"raceacar" is not a palindrome.'),
      t([' '], true, 'After removing non-alphanumeric characters the string is empty, which is a palindrome.'),
    ],
    hidden: [t(['0P'], false), t(['ab_a'], true), t(['No lemon, no melon'], true), t(['a.'], true), t(['abcba1'], false)],
    hints: ['Use one pointer at each end and move them toward each other.', 'Skip characters that are not letters or digits.'],
  },
  {
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'MEDIUM',
    tags: ['Strings', 'Sliding Window', 'Hashing'],
    companies: ['Amazon', 'Adobe', 'Zoho'],
    description: 'Given a string s, return the length of the longest substring that contains no repeated character.',
    constraints: ['0 <= s.length <= 5 * 10^4', 's consists of English letters, digits, symbols and spaces.'],
    functionName: 'lengthOfLongestSubstring',
    params: [['s', 'string']],
    returns: 'int',
    tests: [
      t(['abcabcbb'], 3, 'The answer is "abc".'),
      t(['bbbbb'], 1, 'The answer is "b".'),
      t(['pwwkew'], 3, 'The answer is "wke". Note that "pwke" is a subsequence, not a substring.'),
    ],
    hidden: [t([''], 0), t([' '], 1), t(['dvdf'], 3), t(['abba'], 2), t(['tmmzuxt'], 5), t(['abcdefghij'], 10)],
    hints: ['Keep a window [left, right] that contains no duplicates.', 'Remember the last index of each character so the left edge can jump past a repeat.'],
  },
  {
    title: 'Maximum Average Subarray',
    difficulty: 'EASY',
    tags: ['Arrays', 'Sliding Window'],
    companies: ['Infosys', 'Cognizant'],
    description:
      'You are given an integer array nums and an integer k.\n\n'
      + 'Find the contiguous subarray of length exactly k with the largest average and return that average. Answers within 10^-5 of the correct value are accepted.',
    constraints: ['1 <= k <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4'],
    functionName: 'findMaxAverage',
    params: [['nums', 'int[]'], ['k', 'int']],
    returns: 'double',
    tests: [
      t([[1, 12, -5, -6, 50, 3], 4], 12.75, 'The best window is [12, -5, -6, 50], whose average is 51 / 4 = 12.75.'),
      t([[5], 1], 5),
      t([[0, 4, 0, 3, 2], 1], 4),
    ],
    hidden: [t([[4, 2, 1, 3, 3], 2], 3), t([[-1], 1], -1), t([[1, 2, 3, 4, 5, 6], 3], 5), t([[7, 4, 5, 8, 8, 3, 9, 8, 7, 6], 7], 7), t([[-5, -3, -8], 2], -4)],
    hints: ['Compute the sum of the first k elements.', 'Slide the window: add the entering element and subtract the leaving one.'],
  },
  {
    title: 'Reverse Linked List',
    difficulty: 'EASY',
    tags: ['Linked List', 'Recursion'],
    companies: ['Amazon', 'Microsoft', 'TCS'],
    description: 'Given the head of a singly linked list, reverse the list and return the new head.',
    constraints: ['The number of nodes is in the range [0, 5000].', '-5000 <= Node.val <= 5000'],
    functionName: 'reverseList',
    params: [['head', 'ListNode']],
    returns: 'ListNode',
    tests: [t([[1, 2, 3, 4, 5]], [5, 4, 3, 2, 1]), t([[1, 2]], [2, 1]), t([[]], [])],
    hidden: [t([[7]], [7]), t([[1, 1, 2]], [2, 1, 1]), t([[-1, 0, 1]], [1, 0, -1]), t([[9, 8, 7, 6, 5, 4, 3, 2, 1, 0]], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
    hints: ['Walk the list keeping a pointer to the previous node.', 'Point each node back at the previous one before moving on.'],
  },
  {
    title: 'Merge Two Sorted Lists',
    difficulty: 'EASY',
    tags: ['Linked List', 'Recursion'],
    companies: ['Amazon', 'Wipro', 'Oracle'],
    description: 'You are given the heads of two sorted linked lists, list1 and list2.\n\nMerge them into one sorted list made by splicing together the nodes of the two lists, and return its head.',
    constraints: ['The number of nodes in each list is in the range [0, 50].', '-100 <= Node.val <= 100', 'Both lists are sorted in non-decreasing order.'],
    functionName: 'mergeTwoLists',
    params: [['list1', 'ListNode'], ['list2', 'ListNode']],
    returns: 'ListNode',
    tests: [t([[1, 2, 4], [1, 3, 4]], [1, 1, 2, 3, 4, 4]), t([[], []], []), t([[], [0]], [0])],
    hidden: [t([[5], [1, 2, 3]], [1, 2, 3, 5]), t([[1, 1, 1], [1, 1]], [1, 1, 1, 1, 1]), t([[-3, -1], [-2, 0, 4]], [-3, -2, -1, 0, 4]), t([[2], []], [2])],
    hints: ['A dummy head node removes the special case for the first element.', 'Always attach the smaller of the two current nodes.'],
  },
  {
    title: 'Valid Parentheses',
    difficulty: 'EASY',
    tags: ['Stack', 'Strings'],
    companies: ['TCS', 'Infosys', 'Amazon'],
    description:
      'Given a string s containing only the characters ( ) { } [ ], determine whether it is valid.\n\n'
      + 'A string is valid if every opening bracket is closed by the same type of bracket, and brackets are closed in the correct order.',
    constraints: ['1 <= s.length <= 10^4', 's consists only of the characters ()[]{}.'],
    functionName: 'isValid',
    params: [['s', 'string']],
    returns: 'bool',
    tests: [t(['()'], true), t(['()[]{}'], true), t(['(]'], false)],
    hidden: [t(['([)]'], false), t(['{[]}'], true), t(['('], false), t([']'], false), t(['(((())))[]{}'], true), t(['(()'], false)],
    hints: ['Push opening brackets onto a stack.', 'A closing bracket must match the bracket on top of the stack.'],
  },
  {
    title: 'Daily Temperatures',
    difficulty: 'MEDIUM',
    tags: ['Stack', 'Arrays'],
    companies: ['Amazon', 'Flipkart'],
    description:
      'Given an array temperatures of daily temperatures, return an array answer where answer[i] is the number of days you have to wait after day i to get a warmer temperature.\n\n'
      + 'If there is no future day that is warmer, answer[i] is 0.',
    constraints: ['1 <= temperatures.length <= 10^5', '30 <= temperatures[i] <= 100'],
    functionName: 'dailyTemperatures',
    params: [['temperatures', 'int[]']],
    returns: 'int[]',
    tests: [t([[73, 74, 75, 71, 69, 72, 76, 73]], [1, 1, 4, 2, 1, 1, 0, 0]), t([[30, 40, 50, 60]], [1, 1, 1, 0]), t([[30, 60, 90]], [1, 1, 0])],
    hidden: [t([[90, 80, 70]], [0, 0, 0]), t([[50]], [0]), t([[70, 70, 71]], [2, 1, 0]), t([[55, 38, 53, 81, 61, 93, 97, 32, 43, 78]], [3, 1, 1, 2, 1, 1, 0, 1, 1, 0])],
    hints: ['Keep a stack of indices whose warmer day has not been found yet.', 'When today is warmer than the day on top of the stack, that day\'s answer is known.'],
  },
  {
    title: 'Sliding Window Maximum',
    difficulty: 'HARD',
    tags: ['Queue', 'Sliding Window', 'Arrays'],
    companies: ['Amazon', 'Google', 'Uber'],
    description:
      'You are given an integer array nums and a window of size k that moves from the far left of the array to the far right, one position at a time.\n\n'
      + 'Return an array containing the maximum of each window.',
    constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4', '1 <= k <= nums.length'],
    functionName: 'maxSlidingWindow',
    params: [['nums', 'int[]'], ['k', 'int']],
    returns: 'int[]',
    tests: [
      t([[1, 3, -1, -3, 5, 3, 6, 7], 3], [3, 3, 5, 5, 6, 7], 'The windows are [1,3,-1], [3,-1,-3], [-1,-3,5], [-3,5,3], [5,3,6] and [3,6,7].'),
      t([[1], 1], [1]),
      t([[1, -1], 1], [1, -1]),
    ],
    hidden: [t([[9, 11], 2], [11]), t([[4, -2], 2], [4]), t([[7, 2, 4], 2], [7, 4]), t([[1, 3, 1, 2, 0, 5], 3], [3, 3, 2, 5]), t([[5, 4, 3, 2, 1], 5], [5]), t([[1, 2, 3, 4, 5], 2], [2, 3, 4, 5])],
    hints: ['A double-ended queue can hold the indices of useful candidates.', 'Keep the deque decreasing: an element smaller than a newer one can never be a maximum again.'],
  },
  {
    title: 'Maximum Depth of Binary Tree',
    difficulty: 'EASY',
    tags: ['Trees', 'Recursion'],
    companies: ['Amazon', 'TCS', 'Capgemini'],
    description: 'Given the root of a binary tree, return its maximum depth: the number of nodes along the longest path from the root down to the farthest leaf.',
    constraints: ['The number of nodes is in the range [0, 10^4].', '-100 <= Node.val <= 100'],
    functionName: 'maxDepth',
    params: [['root', 'TreeNode']],
    returns: 'int',
    tests: [t([[3, 9, 20, null, null, 15, 7]], 3), t([[1, null, 2]], 2), t([[]], 0)],
    hidden: [t([[1]], 1), t([[1, 2, 3, 4, 5]], 3), t([[1, 2, null, 3, null, 4]], 4), t([[1, 2, 3, 4, null, null, 5]], 3)],
    hints: ['The depth of an empty tree is 0.', 'The depth of a node is 1 plus the larger depth of its two subtrees.'],
  },
  {
    title: 'Invert Binary Tree',
    difficulty: 'EASY',
    tags: ['Trees', 'Recursion'],
    companies: ['Google', 'Infosys'],
    description: 'Given the root of a binary tree, invert the tree (swap the left and right child of every node) and return its root.',
    constraints: ['The number of nodes is in the range [0, 100].', '-100 <= Node.val <= 100'],
    functionName: 'invertTree',
    params: [['root', 'TreeNode']],
    returns: 'TreeNode',
    tests: [t([[4, 2, 7, 1, 3, 6, 9]], [4, 7, 2, 9, 6, 3, 1]), t([[2, 1, 3]], [2, 3, 1]), t([[]], [])],
    hidden: [t([[1]], [1]), t([[1, 2]], [1, null, 2]), t([[1, null, 2]], [1, 2]), t([[1, 2, 3, 4]], [1, 3, 2, null, null, null, 4])],
    hints: ['Swap the two children of the root.', 'Then do the same for each subtree.'],
  },
  {
    title: 'Binary Tree Level Order Traversal',
    difficulty: 'MEDIUM',
    tags: ['Trees', 'Queue'],
    companies: ['Amazon', 'Microsoft', 'Zoho'],
    description: 'Given the root of a binary tree, return the level order traversal of its node values: level by level from the root down, and left to right within each level.',
    constraints: ['The number of nodes is in the range [0, 2000].', '-1000 <= Node.val <= 1000'],
    functionName: 'levelOrder',
    params: [['root', 'TreeNode']],
    returns: 'list<list<int>>',
    tests: [t([[3, 9, 20, null, null, 15, 7]], [[3], [9, 20], [15, 7]]), t([[1]], [[1]]), t([[]], [])],
    hidden: [t([[1, 2, 3, 4, 5, 6, 7]], [[1], [2, 3], [4, 5, 6, 7]]), t([[1, null, 2, null, 3]], [[1], [2], [3]]), t([[1, 2, null, 3]], [[1], [2], [3]]), t([[5, 4, 8, 11, null, 13, 4]], [[5], [4, 8], [11, 13, 4]])],
    hints: ['Breadth-first search visits a tree one level at a time.', 'Process the queue in batches whose size is the number of nodes on the current level.'],
  },
  {
    title: 'Number of Islands',
    difficulty: 'MEDIUM',
    tags: ['Graphs', 'Recursion'],
    companies: ['Amazon', 'Google', 'Flipkart'],
    description:
      'You are given an m x n grid where 1 represents land and 0 represents water. Return the number of islands.\n\n'
      + 'An island is a group of land cells connected horizontally or vertically. Everything outside the grid is water.',
    constraints: ['1 <= m, n <= 300', 'grid[i][j] is 0 or 1.'],
    functionName: 'numIslands',
    params: [['grid', 'int[][]']],
    returns: 'int',
    tests: [
      t([[[1, 1, 1, 1, 0], [1, 1, 0, 1, 0], [1, 1, 0, 0, 0], [0, 0, 0, 0, 0]]], 1),
      t([[[1, 1, 0, 0, 0], [1, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 1]]], 3),
      t([[[0]]], 0),
    ],
    hidden: [t([[[1]]], 1), t([[[1, 0, 1, 0, 1]]], 3), t([[[1, 0], [0, 1]]], 2), t([[[1, 1, 1], [0, 1, 0], [1, 1, 1]]], 1), t([[[1, 0, 1], [0, 0, 0], [1, 0, 1]]], 4)],
    hints: ['Each time you find unvisited land, you have found a new island.', 'Flood-fill from that cell with DFS or BFS so the rest of the island is not counted again.'],
  },
  {
    title: 'Course Schedule',
    difficulty: 'MEDIUM',
    tags: ['Graphs'],
    companies: ['Amazon', 'Microsoft', 'Zoho'],
    description:
      'There are numCourses courses labelled from 0 to numCourses - 1. You are given an array prerequisites where prerequisites[i] = [a, b] means you must take course b before course a.\n\n'
      + 'Return true if it is possible to finish all courses, and false otherwise.',
    constraints: ['1 <= numCourses <= 2000', '0 <= prerequisites.length <= 5000', 'All prerequisite pairs are distinct.'],
    functionName: 'canFinish',
    params: [['numCourses', 'int'], ['prerequisites', 'int[][]']],
    returns: 'bool',
    tests: [
      t([2, [[1, 0]]], true, 'Take course 0, then course 1.'),
      t([2, [[1, 0], [0, 1]]], false, 'Each course requires the other, so neither can be taken first.'),
      t([1, []], true),
    ],
    hidden: [t([4, [[1, 0], [2, 1], [3, 2]]], true), t([3, [[0, 1], [1, 2], [2, 0]]], false), t([5, [[1, 4], [2, 4], [3, 1], [3, 2]]], true), t([3, [[1, 0], [1, 2], [0, 1]]], false), t([4, [[0, 1], [2, 3]]], true)],
    hints: ['The courses form a directed graph; the question is whether it has a cycle.', 'Kahn\'s algorithm: repeatedly take courses that have no remaining prerequisites.'],
  },
  {
    title: 'Subsets',
    difficulty: 'MEDIUM',
    tags: ['Backtracking', 'Recursion', 'Arrays'],
    companies: ['Amazon', 'Adobe'],
    description: 'Given an integer array nums of unique elements, return all possible subsets (the power set).\n\nThe result must not contain duplicate subsets. You may return the subsets, and the elements inside each subset, in any order.',
    constraints: ['0 <= nums.length <= 10', '-10 <= nums[i] <= 10', 'All elements of nums are unique.'],
    functionName: 'subsets',
    params: [['nums', 'int[]']],
    returns: 'list<list<int>>',
    compare: 'unorderedNested',
    tests: [
      t([[1, 2, 3]], [[], [1], [2], [1, 2], [3], [1, 3], [2, 3], [1, 2, 3]]),
      t([[0]], [[], [0]]),
      t([[1, 2]], [[], [1], [2], [1, 2]]),
    ],
    hidden: [
      t([[]], [[]]),
      t([[-1, 1]], [[], [-1], [1], [-1, 1]]),
      t([[5, 6, 7, 8]], [[], [5], [6], [7], [8], [5, 6], [5, 7], [5, 8], [6, 7], [6, 8], [7, 8], [5, 6, 7], [5, 6, 8], [5, 7, 8], [6, 7, 8], [5, 6, 7, 8]]),
    ],
    hints: ['For every element there are two choices: include it or leave it out.', 'Backtrack: add the element, recurse, then remove it and recurse again.'],
  },
  {
    title: 'Climbing Stairs',
    difficulty: 'EASY',
    tags: ['Dynamic Programming', 'Recursion'],
    companies: ['TCS', 'Accenture', 'Amazon'],
    description: 'You are climbing a staircase that takes n steps to reach the top. Each time you can climb either 1 or 2 steps.\n\nIn how many distinct ways can you climb to the top?',
    constraints: ['1 <= n <= 45'],
    functionName: 'climbStairs',
    params: [['n', 'int']],
    returns: 'int',
    tests: [t([2], 2, 'Either 1 + 1 or 2.'), t([3], 3, '1 + 1 + 1, 1 + 2 or 2 + 1.'), t([1], 1)],
    hidden: [t([5], 8), t([10], 89), t([20], 10946), t([30], 1346269), t([45], 1836311903)],
    hints: ['The last move is either one step or two steps.', 'So ways(n) = ways(n - 1) + ways(n - 2). Plain recursion repeats work; remember the previous two values.'],
  },
  {
    title: 'Coin Change',
    difficulty: 'MEDIUM',
    tags: ['Dynamic Programming'],
    companies: ['Amazon', 'Flipkart', 'Zoho'],
    description:
      'You are given an array coins of coin denominations and an integer amount.\n\n'
      + 'Return the fewest number of coins needed to make up that amount, or -1 if it cannot be made. You have an unlimited number of each coin.',
    constraints: ['1 <= coins.length <= 12', '1 <= coins[i] <= 10^4', '0 <= amount <= 10^4'],
    functionName: 'coinChange',
    params: [['coins', 'int[]'], ['amount', 'int']],
    returns: 'int',
    tests: [t([[1, 2, 5], 11], 3, '11 = 5 + 5 + 1.'), t([[2], 3], -1), t([[1], 0], 0)],
    hidden: [t([[1], 2], 2), t([[2, 5, 10, 1], 27], 4), t([[186, 419, 83, 408], 6249], 20), t([[3, 7], 5], -1), t([[1, 3, 4], 6], 2), t([[5], 10], 2)],
    hints: ['Taking the largest coin first does not always work (try coins [1, 3, 4] and amount 6).', 'Let dp[x] be the fewest coins for amount x, and build it up from 0.'],
  },
  {
    title: 'Longest Common Subsequence',
    difficulty: 'MEDIUM',
    tags: ['Dynamic Programming', 'Strings'],
    companies: ['Amazon', 'Google', 'Oracle'],
    description:
      'Given two strings text1 and text2, return the length of their longest common subsequence, or 0 if they have none.\n\n'
      + 'A subsequence is formed by deleting some (possibly zero) characters from a string without changing the order of the rest.',
    constraints: ['1 <= text1.length, text2.length <= 1000', 'Both strings consist of lowercase English letters.'],
    functionName: 'longestCommonSubsequence',
    params: [['text1', 'string'], ['text2', 'string']],
    returns: 'int',
    tests: [t(['abcde', 'ace'], 3, 'The longest common subsequence is "ace".'), t(['abc', 'abc'], 3), t(['abc', 'def'], 0)],
    hidden: [t(['a', 'a'], 1), t(['bl', 'yby'], 1), t(['ezupkr', 'ubmrapg'], 2), t(['oxcpqrsvwf', 'shmtulqrypy'], 2), t(['aaaa', 'aa'], 2)],
    hints: ['Compare the last characters of the two prefixes.', 'If they match, extend the answer for both shorter prefixes; otherwise take the better of dropping one character from either.'],
  },
  {
    title: 'Jump Game',
    difficulty: 'MEDIUM',
    tags: ['Greedy', 'Arrays'],
    companies: ['Amazon', 'Microsoft'],
    description: 'You are given an integer array nums. You start at the first index, and each element is the maximum jump length from that position.\n\nReturn true if you can reach the last index, and false otherwise.',
    constraints: ['1 <= nums.length <= 10^4', '0 <= nums[i] <= 10^5'],
    functionName: 'canJump',
    params: [['nums', 'int[]']],
    returns: 'bool',
    tests: [
      t([[2, 3, 1, 1, 4]], true, 'Jump 1 step to index 1, then 3 steps to the last index.'),
      t([[3, 2, 1, 0, 4]], false, 'Every path arrives at index 3, whose jump length is 0.'),
      t([[0]], true),
    ],
    hidden: [t([[1, 0]], true), t([[0, 1]], false), t([[2, 0, 0]], true), t([[1, 1, 0, 1]], false), t([[5, 0, 0, 0, 0, 0]], true), t([[2, 5, 0, 0]], true)],
    hints: ['Track the farthest index you can reach so far.', 'If you ever stand on an index beyond that reach, the end is unreachable.'],
  },
  {
    title: 'Merge Intervals',
    difficulty: 'MEDIUM',
    tags: ['Sorting', 'Arrays'],
    companies: ['Amazon', 'Google', 'Zoho'],
    description:
      'Given an array of intervals where intervals[i] = [start, end], merge all overlapping intervals.\n\n'
      + 'Return the non-overlapping intervals that cover all the input intervals, sorted by start. Intervals that only touch, such as [1,4] and [4,5], count as overlapping.',
    constraints: ['1 <= intervals.length <= 10^4', '0 <= start <= end <= 10^4'],
    functionName: 'merge',
    params: [['intervals', 'int[][]']],
    returns: 'int[][]',
    tests: [
      t([[[1, 3], [2, 6], [8, 10], [15, 18]]], [[1, 6], [8, 10], [15, 18]], '[1,3] and [2,6] overlap and merge into [1,6].'),
      t([[[1, 4], [4, 5]]], [[1, 5]]),
      t([[[1, 4]]], [[1, 4]]),
    ],
    hidden: [t([[[1, 4], [0, 4]]], [[0, 4]]), t([[[1, 4], [2, 3]]], [[1, 4]]), t([[[2, 3], [4, 5], [6, 7], [8, 9], [1, 10]]], [[1, 10]]), t([[[1, 4], [0, 0]]], [[0, 0], [1, 4]]), t([[[5, 6], [1, 2], [3, 4]]], [[1, 2], [3, 4], [5, 6]])],
    hints: ['Sort the intervals by start.', 'Then each interval either extends the last merged interval or starts a new one.'],
  },
  {
    title: 'Binary Search',
    difficulty: 'EASY',
    tags: ['Binary Search', 'Arrays'],
    companies: ['TCS', 'Wipro', 'Infosys'],
    description: 'Given an array nums of distinct integers sorted in ascending order and an integer target, return the index of target, or -1 if it is not present.\n\nYour algorithm must run in O(log n) time.',
    constraints: ['1 <= nums.length <= 10^4', '-10^4 < nums[i], target < 10^4', 'All values in nums are unique and sorted ascending.'],
    functionName: 'search',
    params: [['nums', 'int[]'], ['target', 'int']],
    returns: 'int',
    tests: [t([[-1, 0, 3, 5, 9, 12], 9], 4, '9 is at index 4.'), t([[-1, 0, 3, 5, 9, 12], 2], -1, '2 is not in the array.'), t([[5], 5], 0)],
    hidden: [t([[5], -5], -1), t([[1, 3], 3], 1), t([[1, 3], 1], 0), t([[2, 4, 6, 8, 10, 12, 14], 14], 6), t([[2, 4, 6, 8, 10, 12, 14], 1], -1)],
    hints: ['Compare target with the middle element.', 'Discard the half that cannot contain it and repeat.'],
  },
  {
    title: 'Search in Rotated Sorted Array',
    difficulty: 'MEDIUM',
    tags: ['Binary Search', 'Arrays'],
    companies: ['Amazon', 'Microsoft', 'Adobe'],
    description:
      'An array sorted in ascending order with distinct values has been rotated at an unknown pivot, for example [0,1,2,4,5,6,7] may become [4,5,6,7,0,1,2].\n\n'
      + 'Given the rotated array nums and an integer target, return the index of target, or -1 if it is not present. Your algorithm must run in O(log n) time.',
    constraints: ['1 <= nums.length <= 5000', '-10^4 <= nums[i], target <= 10^4', 'All values of nums are unique.'],
    functionName: 'search',
    params: [['nums', 'int[]'], ['target', 'int']],
    returns: 'int',
    tests: [t([[4, 5, 6, 7, 0, 1, 2], 0], 4), t([[4, 5, 6, 7, 0, 1, 2], 3], -1), t([[1], 0], -1)],
    hidden: [t([[1], 1], 0), t([[3, 1], 1], 1), t([[5, 1, 3], 5], 0), t([[4, 5, 6, 7, 8, 1, 2, 3], 8], 4), t([[1, 3], 3], 1), t([[6, 7, 1, 2, 3, 4, 5], 6], 0)],
    hints: ['At least one half of any range is still sorted.', 'Decide which half is sorted, then check whether target lies inside it.'],
  },
  {
    title: 'Group Anagrams',
    difficulty: 'MEDIUM',
    tags: ['Hashing', 'Strings', 'Sorting'],
    companies: ['Amazon', 'Zoho', 'Uber'],
    description: 'Given an array of strings strs, group the anagrams together.\n\nYou may return the groups, and the words inside each group, in any order.',
    constraints: ['1 <= strs.length <= 10^4', '0 <= strs[i].length <= 100', 'strs[i] consists of lowercase English letters.'],
    functionName: 'groupAnagrams',
    params: [['strs', 'string[]']],
    returns: 'list<list<string>>',
    compare: 'unorderedNested',
    tests: [
      t([['eat', 'tea', 'tan', 'ate', 'nat', 'bat']], [['bat'], ['nat', 'tan'], ['ate', 'eat', 'tea']]),
      t([['']], [['']]),
      t([['a']], [['a']]),
    ],
    hidden: [
      t([['ab', 'ba', 'abc', 'cab', 'x']], [['ab', 'ba'], ['abc', 'cab'], ['x']]),
      t([['', '']], [['', '']]),
      t([['abc', 'def']], [['abc'], ['def']]),
      t([['aab', 'aba', 'baa', 'abb']], [['aab', 'aba', 'baa'], ['abb']]),
    ],
    hints: ['Two words are anagrams exactly when their sorted letters are equal.', 'Use the sorted word as a hash map key.'],
  },
  {
    title: 'Trapping Rain Water',
    difficulty: 'HARD',
    tags: ['Two Pointers', 'Dynamic Programming', 'Stack'],
    companies: ['Amazon', 'Google', 'Goldman Sachs'],
    description: 'Given n non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.',
    constraints: ['1 <= height.length <= 2 * 10^4', '0 <= height[i] <= 10^5'],
    functionName: 'trap',
    params: [['height', 'int[]']],
    returns: 'int',
    tests: [t([[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], 6), t([[4, 2, 0, 3, 2, 5]], 9), t([[1]], 0)],
    hidden: [t([[2, 0, 2]], 2), t([[3, 2, 1]], 0), t([[5, 4, 1, 2]], 1), t([[0, 0, 0]], 0), t([[4, 2, 3]], 1), t([[9, 6, 8, 8, 5, 6, 3]], 3)],
    hints: ['Water above a bar is limited by the tallest bar on its left and on its right.', 'Two pointers moving inward can track both maxima in O(1) extra space.'],
  },
  {
    title: 'N-Queens Count',
    difficulty: 'HARD',
    tags: ['Backtracking', 'Recursion'],
    companies: ['Google', 'Microsoft'],
    description: 'The n-queens puzzle is the problem of placing n queens on an n x n chessboard so that no two queens attack each other.\n\nGiven an integer n, return the number of distinct solutions.',
    constraints: ['1 <= n <= 9'],
    functionName: 'totalNQueens',
    params: [['n', 'int']],
    returns: 'int',
    tests: [t([4], 2), t([1], 1), t([2], 0)],
    hidden: [t([3], 0), t([5], 10), t([6], 4), t([8], 92), t([9], 352)],
    hints: ['Place one queen per row.', 'Track which columns and which two kinds of diagonals are already attacked, and undo the choice when you backtrack.'],
  },
  {
    title: 'Fibonacci Number',
    difficulty: 'EASY',
    tags: ['Dynamic Programming', 'Recursion'],
    companies: ['TCS', 'Cognizant', 'Capgemini'],
    description: 'The Fibonacci numbers are defined by F(0) = 0, F(1) = 1 and F(n) = F(n - 1) + F(n - 2) for n > 1.\n\nGiven n, return F(n). The answer can be larger than a 32-bit integer.',
    constraints: ['0 <= n <= 78'],
    functionName: 'fib',
    params: [['n', 'int']],
    returns: 'long',
    tests: [t([0], 0), t([1], 1), t([10], 55)],
    hidden: [t([2], 1), t([30], 832040), t([50], 12586269025), t([70], 190392490709135), t([78], 8944394323791464)],
    hints: ['Naive recursion recomputes the same values exponentially many times.', 'Keep only the previous two numbers and iterate.'],
  },
];
