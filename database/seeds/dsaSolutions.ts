/**
 * Reference solutions for the DSA problems, in every supported language.
 *
 * Their purpose is verification: the test suite and `npm run judge:verify`
 * judge each one and require "Accepted", which proves that the generated
 * harness, the test data and the comparator agree for every language. They are
 * stored server-side only and are never sent to students.
 */

export interface DsaReferenceSolution {
  python: string;
  cpp: string;
  java: string;
  javascript: string;
}

export const DSA_REFERENCE_SOLUTIONS: Record<string, DsaReferenceSolution> = {
  'Two Sum': {
    python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, v in enumerate(nums):
            if target - v in seen:
                return [seen[target - v], i]
            seen[v] = i
        return []
`,
    cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<long long, int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            auto it = seen.find((long long)target - nums[i]);
            if (it != seen.end()) return {it->second, i};
            seen[nums[i]] = i;
        }
        return {};
    }
};
`,
    java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[]{j, i};
            seen.put(nums[i], i);
        }
        return new int[0];
    }
}
`,
    javascript: `var twoSum = function(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) {
        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
        seen.set(nums[i], i);
    }
    return [];
};
`,
  },

  'Best Time to Buy and Sell Stock': {
    python: `class Solution:
    def maxProfit(self, prices: List[int]) -> int:
        low, best = prices[0], 0
        for p in prices:
            low = min(low, p)
            best = max(best, p - low)
        return best
`,
    cpp: `class Solution {
public:
    int maxProfit(vector<int>& prices) {
        int low = prices[0], best = 0;
        for (int p : prices) { low = min(low, p); best = max(best, p - low); }
        return best;
    }
};
`,
    java: `class Solution {
    public int maxProfit(int[] prices) {
        int low = prices[0], best = 0;
        for (int p : prices) { low = Math.min(low, p); best = Math.max(best, p - low); }
        return best;
    }
}
`,
    javascript: `var maxProfit = function(prices) {
    let low = prices[0], best = 0;
    for (const p of prices) { low = Math.min(low, p); best = Math.max(best, p - low); }
    return best;
};
`,
  },

  'Valid Anagram': {
    python: `class Solution:
    def isAnagram(self, s: str, t: str) -> bool:
        return Counter(s) == Counter(t)
`,
    cpp: `class Solution {
public:
    bool isAnagram(string s, string t) {
        if (s.size() != t.size()) return false;
        int count[256] = {0};
        for (unsigned char c : s) count[c]++;
        for (unsigned char c : t) if (--count[c] < 0) return false;
        return true;
    }
};
`,
    java: `class Solution {
    public boolean isAnagram(String s, String t) {
        if (s.length() != t.length()) return false;
        int[] count = new int[256];
        for (char c : s.toCharArray()) count[c]++;
        for (char c : t.toCharArray()) if (--count[c] < 0) return false;
        return true;
    }
}
`,
    javascript: `var isAnagram = function(s, t) {
    if (s.length !== t.length) return false;
    const count = {};
    for (const c of s) count[c] = (count[c] || 0) + 1;
    for (const c of t) { if (!count[c]) return false; count[c]--; }
    return true;
};
`,
  },

  'Valid Palindrome': {
    python: `class Solution:
    def isPalindrome(self, s: str) -> bool:
        chars = [c.lower() for c in s if c.isalnum()]
        return chars == chars[::-1]
`,
    cpp: `class Solution {
public:
    bool isPalindrome(string s) {
        int i = 0, j = (int)s.size() - 1;
        while (i < j) {
            if (!isalnum((unsigned char)s[i])) { i++; continue; }
            if (!isalnum((unsigned char)s[j])) { j--; continue; }
            if (tolower((unsigned char)s[i]) != tolower((unsigned char)s[j])) return false;
            i++; j--;
        }
        return true;
    }
};
`,
    java: `class Solution {
    public boolean isPalindrome(String s) {
        int i = 0, j = s.length() - 1;
        while (i < j) {
            if (!Character.isLetterOrDigit(s.charAt(i))) { i++; continue; }
            if (!Character.isLetterOrDigit(s.charAt(j))) { j--; continue; }
            if (Character.toLowerCase(s.charAt(i)) != Character.toLowerCase(s.charAt(j))) return false;
            i++; j--;
        }
        return true;
    }
}
`,
    javascript: `var isPalindrome = function(s) {
    const chars = s.toLowerCase().split('').filter((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'));
    for (let i = 0, j = chars.length - 1; i < j; i++, j--) {
        if (chars[i] !== chars[j]) return false;
    }
    return true;
};
`,
  },

  'Longest Substring Without Repeating Characters': {
    python: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last, left, best = {}, 0, 0
        for right, c in enumerate(s):
            if c in last and last[c] >= left:
                left = last[c] + 1
            last[c] = right
            best = max(best, right - left + 1)
        return best
`,
    cpp: `class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        vector<int> last(256, -1);
        int left = 0, best = 0;
        for (int right = 0; right < (int)s.size(); right++) {
            unsigned char c = s[right];
            if (last[c] >= left) left = last[c] + 1;
            last[c] = right;
            best = max(best, right - left + 1);
        }
        return best;
    }
};
`,
    java: `class Solution {
    public int lengthOfLongestSubstring(String s) {
        Map<Character, Integer> last = new HashMap<>();
        int left = 0, best = 0;
        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);
            if (last.containsKey(c) && last.get(c) >= left) left = last.get(c) + 1;
            last.put(c, right);
            best = Math.max(best, right - left + 1);
        }
        return best;
    }
}
`,
    javascript: `var lengthOfLongestSubstring = function(s) {
    const last = new Map();
    let left = 0, best = 0;
    for (let right = 0; right < s.length; right++) {
        const c = s[right];
        if (last.has(c) && last.get(c) >= left) left = last.get(c) + 1;
        last.set(c, right);
        best = Math.max(best, right - left + 1);
    }
    return best;
};
`,
  },

  'Maximum Average Subarray': {
    python: `class Solution:
    def findMaxAverage(self, nums: List[int], k: int) -> float:
        window = sum(nums[:k])
        best = window
        for i in range(k, len(nums)):
            window += nums[i] - nums[i - k]
            best = max(best, window)
        return best / k
`,
    cpp: `class Solution {
public:
    double findMaxAverage(vector<int>& nums, int k) {
        long long window = 0;
        for (int i = 0; i < k; i++) window += nums[i];
        long long best = window;
        for (int i = k; i < (int)nums.size(); i++) {
            window += nums[i] - nums[i - k];
            best = max(best, window);
        }
        return (double)best / k;
    }
};
`,
    java: `class Solution {
    public double findMaxAverage(int[] nums, int k) {
        long window = 0;
        for (int i = 0; i < k; i++) window += nums[i];
        long best = window;
        for (int i = k; i < nums.length; i++) {
            window += nums[i] - nums[i - k];
            best = Math.max(best, window);
        }
        return (double) best / k;
    }
}
`,
    javascript: `var findMaxAverage = function(nums, k) {
    let window = 0;
    for (let i = 0; i < k; i++) window += nums[i];
    let best = window;
    for (let i = k; i < nums.length; i++) {
        window += nums[i] - nums[i - k];
        best = Math.max(best, window);
    }
    return best / k;
};
`,
  },

  'Reverse Linked List': {
    python: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        while head:
            head.next, prev, head = prev, head, head.next
        return prev
`,
    cpp: `class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* prev = nullptr;
        while (head) { ListNode* next = head->next; head->next = prev; prev = head; head = next; }
        return prev;
    }
};
`,
    java: `class Solution {
    public ListNode reverseList(ListNode head) {
        ListNode prev = null;
        while (head != null) { ListNode next = head.next; head.next = prev; prev = head; head = next; }
        return prev;
    }
}
`,
    javascript: `var reverseList = function(head) {
    let prev = null;
    while (head) { const next = head.next; head.next = prev; prev = head; head = next; }
    return prev;
};
`,
  },

  'Merge Two Sorted Lists': {
    python: `class Solution:
    def mergeTwoLists(self, list1: Optional[ListNode], list2: Optional[ListNode]) -> Optional[ListNode]:
        dummy = tail = ListNode()
        while list1 and list2:
            if list1.val <= list2.val:
                tail.next, list1 = list1, list1.next
            else:
                tail.next, list2 = list2, list2.next
            tail = tail.next
        tail.next = list1 or list2
        return dummy.next
`,
    cpp: `class Solution {
public:
    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {
        ListNode dummy; ListNode* tail = &dummy;
        while (list1 && list2) {
            if (list1->val <= list2->val) { tail->next = list1; list1 = list1->next; }
            else { tail->next = list2; list2 = list2->next; }
            tail = tail->next;
        }
        tail->next = list1 ? list1 : list2;
        return dummy.next;
    }
};
`,
    java: `class Solution {
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        ListNode dummy = new ListNode(), tail = dummy;
        while (list1 != null && list2 != null) {
            if (list1.val <= list2.val) { tail.next = list1; list1 = list1.next; }
            else { tail.next = list2; list2 = list2.next; }
            tail = tail.next;
        }
        tail.next = list1 != null ? list1 : list2;
        return dummy.next;
    }
}
`,
    javascript: `var mergeTwoLists = function(list1, list2) {
    const dummy = new ListNode(); let tail = dummy;
    while (list1 && list2) {
        if (list1.val <= list2.val) { tail.next = list1; list1 = list1.next; }
        else { tail.next = list2; list2 = list2.next; }
        tail = tail.next;
    }
    tail.next = list1 || list2;
    return dummy.next;
};
`,
  },

  'Valid Parentheses': {
    python: `class Solution:
    def isValid(self, s: str) -> bool:
        pairs = {')': '(', ']': '[', '}': '{'}
        stack = []
        for c in s:
            if c in pairs:
                if not stack or stack.pop() != pairs[c]:
                    return False
            else:
                stack.append(c)
        return not stack
`,
    cpp: `class Solution {
public:
    bool isValid(string s) {
        vector<char> st;
        for (char c : s) {
            if (c == '(' || c == '[' || c == '{') { st.push_back(c); continue; }
            if (st.empty()) return false;
            char open = st.back(); st.pop_back();
            if ((c == ')' && open != '(') || (c == ']' && open != '[') || (c == '}' && open != '{')) return false;
        }
        return st.empty();
    }
};
`,
    java: `class Solution {
    public boolean isValid(String s) {
        Deque<Character> st = new ArrayDeque<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') { st.push(c); continue; }
            if (st.isEmpty()) return false;
            char open = st.pop();
            if ((c == ')' && open != '(') || (c == ']' && open != '[') || (c == '}' && open != '{')) return false;
        }
        return st.isEmpty();
    }
}
`,
    javascript: `var isValid = function(s) {
    const pairs = { ')': '(', ']': '[', '}': '{' };
    const stack = [];
    for (const c of s) {
        if (pairs[c]) { if (stack.pop() !== pairs[c]) return false; }
        else stack.push(c);
    }
    return stack.length === 0;
};
`,
  },

  'Daily Temperatures': {
    python: `class Solution:
    def dailyTemperatures(self, temperatures: List[int]) -> List[int]:
        answer = [0] * len(temperatures)
        stack = []
        for i, temp in enumerate(temperatures):
            while stack and temperatures[stack[-1]] < temp:
                j = stack.pop()
                answer[j] = i - j
            stack.append(i)
        return answer
`,
    cpp: `class Solution {
public:
    vector<int> dailyTemperatures(vector<int>& temperatures) {
        int n = temperatures.size();
        vector<int> answer(n, 0), st;
        for (int i = 0; i < n; i++) {
            while (!st.empty() && temperatures[st.back()] < temperatures[i]) { answer[st.back()] = i - st.back(); st.pop_back(); }
            st.push_back(i);
        }
        return answer;
    }
};
`,
    java: `class Solution {
    public int[] dailyTemperatures(int[] temperatures) {
        int n = temperatures.length;
        int[] answer = new int[n];
        Deque<Integer> st = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            while (!st.isEmpty() && temperatures[st.peek()] < temperatures[i]) { int j = st.pop(); answer[j] = i - j; }
            st.push(i);
        }
        return answer;
    }
}
`,
    javascript: `var dailyTemperatures = function(temperatures) {
    const answer = new Array(temperatures.length).fill(0);
    const stack = [];
    for (let i = 0; i < temperatures.length; i++) {
        while (stack.length && temperatures[stack[stack.length - 1]] < temperatures[i]) { const j = stack.pop(); answer[j] = i - j; }
        stack.push(i);
    }
    return answer;
};
`,
  },

  'Sliding Window Maximum': {
    python: `class Solution:
    def maxSlidingWindow(self, nums: List[int], k: int) -> List[int]:
        dq, out = deque(), []
        for i, v in enumerate(nums):
            while dq and nums[dq[-1]] <= v:
                dq.pop()
            dq.append(i)
            if dq[0] <= i - k:
                dq.popleft()
            if i >= k - 1:
                out.append(nums[dq[0]])
        return out
`,
    cpp: `class Solution {
public:
    vector<int> maxSlidingWindow(vector<int>& nums, int k) {
        deque<int> dq; vector<int> out;
        for (int i = 0; i < (int)nums.size(); i++) {
            while (!dq.empty() && nums[dq.back()] <= nums[i]) dq.pop_back();
            dq.push_back(i);
            if (dq.front() <= i - k) dq.pop_front();
            if (i >= k - 1) out.push_back(nums[dq.front()]);
        }
        return out;
    }
};
`,
    java: `class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        Deque<Integer> dq = new ArrayDeque<>();
        int[] out = new int[nums.length - k + 1];
        for (int i = 0; i < nums.length; i++) {
            while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) dq.pollLast();
            dq.addLast(i);
            if (dq.peekFirst() <= i - k) dq.pollFirst();
            if (i >= k - 1) out[i - k + 1] = nums[dq.peekFirst()];
        }
        return out;
    }
}
`,
    javascript: `var maxSlidingWindow = function(nums, k) {
    const dq = []; const out = []; let head = 0;
    for (let i = 0; i < nums.length; i++) {
        while (dq.length > head && nums[dq[dq.length - 1]] <= nums[i]) dq.pop();
        dq.push(i);
        if (dq[head] <= i - k) head++;
        if (i >= k - 1) out.push(nums[dq[head]]);
    }
    return out;
};
`,
  },

  'Maximum Depth of Binary Tree': {
    python: `class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if not root:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
`,
    cpp: `class Solution {
public:
    int maxDepth(TreeNode* root) {
        if (!root) return 0;
        return 1 + max(maxDepth(root->left), maxDepth(root->right));
    }
};
`,
    java: `class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) return 0;
        return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
    }
}
`,
    javascript: `var maxDepth = function(root) {
    if (!root) return 0;
    return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
};
`,
  },

  'Invert Binary Tree': {
    python: `class Solution:
    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:
        if root:
            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)
        return root
`,
    cpp: `class Solution {
public:
    TreeNode* invertTree(TreeNode* root) {
        if (!root) return root;
        swap(root->left, root->right);
        invertTree(root->left); invertTree(root->right);
        return root;
    }
};
`,
    java: `class Solution {
    public TreeNode invertTree(TreeNode root) {
        if (root == null) return null;
        TreeNode left = invertTree(root.left);
        root.left = invertTree(root.right);
        root.right = left;
        return root;
    }
}
`,
    javascript: `var invertTree = function(root) {
    if (!root) return root;
    const left = invertTree(root.left);
    root.left = invertTree(root.right);
    root.right = left;
    return root;
};
`,
  },

  'Binary Tree Level Order Traversal': {
    python: `class Solution:
    def levelOrder(self, root: Optional[TreeNode]) -> List[List[int]]:
        out, level = [], [root] if root else []
        while level:
            out.append([n.val for n in level])
            level = [c for n in level for c in (n.left, n.right) if c]
        return out
`,
    cpp: `class Solution {
public:
    vector<vector<int>> levelOrder(TreeNode* root) {
        vector<vector<int>> out;
        if (!root) return out;
        queue<TreeNode*> q; q.push(root);
        while (!q.empty()) {
            int size = q.size(); vector<int> level;
            for (int i = 0; i < size; i++) {
                TreeNode* node = q.front(); q.pop();
                level.push_back(node->val);
                if (node->left) q.push(node->left);
                if (node->right) q.push(node->right);
            }
            out.push_back(level);
        }
        return out;
    }
};
`,
    java: `class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        List<List<Integer>> out = new ArrayList<>();
        if (root == null) return out;
        Deque<TreeNode> q = new ArrayDeque<>(); q.add(root);
        while (!q.isEmpty()) {
            int size = q.size(); List<Integer> level = new ArrayList<>();
            for (int i = 0; i < size; i++) {
                TreeNode node = q.poll();
                level.add(node.val);
                if (node.left != null) q.add(node.left);
                if (node.right != null) q.add(node.right);
            }
            out.add(level);
        }
        return out;
    }
}
`,
    javascript: `var levelOrder = function(root) {
    const out = []; let level = root ? [root] : [];
    while (level.length) {
        out.push(level.map((n) => n.val));
        const next = [];
        for (const n of level) { if (n.left) next.push(n.left); if (n.right) next.push(n.right); }
        level = next;
    }
    return out;
};
`,
  },

  'Number of Islands': {
    python: `class Solution:
    def numIslands(self, grid: List[List[int]]) -> int:
        rows, cols, count = len(grid), len(grid[0]), 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] != 1:
                    continue
                count += 1
                stack = [(r, c)]
                grid[r][c] = 0
                while stack:
                    y, x = stack.pop()
                    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == 1:
                            grid[ny][nx] = 0
                            stack.append((ny, nx))
        return count
`,
    cpp: `class Solution {
    void sink(vector<vector<int>>& g, int r, int c) {
        if (r < 0 || c < 0 || r >= (int)g.size() || c >= (int)g[0].size() || g[r][c] != 1) return;
        g[r][c] = 0;
        sink(g, r + 1, c); sink(g, r - 1, c); sink(g, r, c + 1); sink(g, r, c - 1);
    }
public:
    int numIslands(vector<vector<int>>& grid) {
        int count = 0;
        for (int r = 0; r < (int)grid.size(); r++)
            for (int c = 0; c < (int)grid[0].size(); c++)
                if (grid[r][c] == 1) { count++; sink(grid, r, c); }
        return count;
    }
};
`,
    java: `class Solution {
    private void sink(int[][] g, int r, int c) {
        if (r < 0 || c < 0 || r >= g.length || c >= g[0].length || g[r][c] != 1) return;
        g[r][c] = 0;
        sink(g, r + 1, c); sink(g, r - 1, c); sink(g, r, c + 1); sink(g, r, c - 1);
    }
    public int numIslands(int[][] grid) {
        int count = 0;
        for (int r = 0; r < grid.length; r++)
            for (int c = 0; c < grid[0].length; c++)
                if (grid[r][c] == 1) { count++; sink(grid, r, c); }
        return count;
    }
}
`,
    javascript: `var numIslands = function(grid) {
    const sink = (r, c) => {
        if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length || grid[r][c] !== 1) return;
        grid[r][c] = 0;
        sink(r + 1, c); sink(r - 1, c); sink(r, c + 1); sink(r, c - 1);
    };
    let count = 0;
    for (let r = 0; r < grid.length; r++)
        for (let c = 0; c < grid[0].length; c++)
            if (grid[r][c] === 1) { count++; sink(r, c); }
    return count;
};
`,
  },

  'Course Schedule': {
    python: `class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        graph = [[] for _ in range(numCourses)]
        indegree = [0] * numCourses
        for a, b in prerequisites:
            graph[b].append(a)
            indegree[a] += 1
        queue = deque(i for i in range(numCourses) if indegree[i] == 0)
        taken = 0
        while queue:
            node = queue.popleft()
            taken += 1
            for nxt in graph[node]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    queue.append(nxt)
        return taken == numCourses
`,
    cpp: `class Solution {
public:
    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {
        vector<vector<int>> graph(numCourses); vector<int> indegree(numCourses, 0);
        for (auto& p : prerequisites) { graph[p[1]].push_back(p[0]); indegree[p[0]]++; }
        queue<int> q;
        for (int i = 0; i < numCourses; i++) if (indegree[i] == 0) q.push(i);
        int taken = 0;
        while (!q.empty()) {
            int node = q.front(); q.pop(); taken++;
            for (int nxt : graph[node]) if (--indegree[nxt] == 0) q.push(nxt);
        }
        return taken == numCourses;
    }
};
`,
    java: `class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) graph.add(new ArrayList<>());
        int[] indegree = new int[numCourses];
        for (int[] p : prerequisites) { graph.get(p[1]).add(p[0]); indegree[p[0]]++; }
        Deque<Integer> q = new ArrayDeque<>();
        for (int i = 0; i < numCourses; i++) if (indegree[i] == 0) q.add(i);
        int taken = 0;
        while (!q.isEmpty()) {
            int node = q.poll(); taken++;
            for (int nxt : graph.get(node)) if (--indegree[nxt] == 0) q.add(nxt);
        }
        return taken == numCourses;
    }
}
`,
    javascript: `var canFinish = function(numCourses, prerequisites) {
    const graph = Array.from({ length: numCourses }, () => []);
    const indegree = new Array(numCourses).fill(0);
    for (const [a, b] of prerequisites) { graph[b].push(a); indegree[a]++; }
    const queue = [];
    for (let i = 0; i < numCourses; i++) if (indegree[i] === 0) queue.push(i);
    let taken = 0;
    for (let head = 0; head < queue.length; head++) {
        taken++;
        for (const nxt of graph[queue[head]]) if (--indegree[nxt] === 0) queue.push(nxt);
    }
    return taken === numCourses;
};
`,
  },

  Subsets: {
    python: `class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        out, path = [], []
        def walk(i):
            if i == len(nums):
                out.append(path[:])
                return
            walk(i + 1)
            path.append(nums[i])
            walk(i + 1)
            path.pop()
        walk(0)
        return out
`,
    cpp: `class Solution {
    void walk(vector<int>& nums, int i, vector<int>& path, vector<vector<int>>& out) {
        if (i == (int)nums.size()) { out.push_back(path); return; }
        walk(nums, i + 1, path, out);
        path.push_back(nums[i]);
        walk(nums, i + 1, path, out);
        path.pop_back();
    }
public:
    vector<vector<int>> subsets(vector<int>& nums) {
        vector<vector<int>> out; vector<int> path;
        walk(nums, 0, path, out);
        return out;
    }
};
`,
    java: `class Solution {
    private void walk(int[] nums, int i, List<Integer> path, List<List<Integer>> out) {
        if (i == nums.length) { out.add(new ArrayList<>(path)); return; }
        walk(nums, i + 1, path, out);
        path.add(nums[i]);
        walk(nums, i + 1, path, out);
        path.remove(path.size() - 1);
    }
    public List<List<Integer>> subsets(int[] nums) {
        List<List<Integer>> out = new ArrayList<>();
        walk(nums, 0, new ArrayList<>(), out);
        return out;
    }
}
`,
    javascript: `var subsets = function(nums) {
    const out = []; const path = [];
    const walk = (i) => {
        if (i === nums.length) { out.push(path.slice()); return; }
        walk(i + 1);
        path.push(nums[i]);
        walk(i + 1);
        path.pop();
    };
    walk(0);
    return out;
};
`,
  },

  'Climbing Stairs': {
    python: `class Solution:
    def climbStairs(self, n: int) -> int:
        a, b = 1, 1
        for _ in range(n):
            a, b = b, a + b
        return a
`,
    cpp: `class Solution {
public:
    int climbStairs(int n) {
        long long a = 1, b = 1;
        for (int i = 0; i < n; i++) { long long c = a + b; a = b; b = c; }
        return (int)a;
    }
};
`,
    java: `class Solution {
    public int climbStairs(int n) {
        long a = 1, b = 1;
        for (int i = 0; i < n; i++) { long c = a + b; a = b; b = c; }
        return (int) a;
    }
}
`,
    javascript: `var climbStairs = function(n) {
    let a = 1, b = 1;
    for (let i = 0; i < n; i++) { const c = a + b; a = b; b = c; }
    return a;
};
`,
  },

  'Coin Change': {
    python: `class Solution:
    def coinChange(self, coins: List[int], amount: int) -> int:
        dp = [0] + [amount + 1] * amount
        for x in range(1, amount + 1):
            for c in coins:
                if c <= x and dp[x - c] + 1 < dp[x]:
                    dp[x] = dp[x - c] + 1
        return dp[amount] if dp[amount] <= amount else -1
`,
    cpp: `class Solution {
public:
    int coinChange(vector<int>& coins, int amount) {
        vector<int> dp(amount + 1, amount + 1);
        dp[0] = 0;
        for (int x = 1; x <= amount; x++)
            for (int c : coins)
                if (c <= x) dp[x] = min(dp[x], dp[x - c] + 1);
        return dp[amount] > amount ? -1 : dp[amount];
    }
};
`,
    java: `class Solution {
    public int coinChange(int[] coins, int amount) {
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, amount + 1);
        dp[0] = 0;
        for (int x = 1; x <= amount; x++)
            for (int c : coins)
                if (c <= x) dp[x] = Math.min(dp[x], dp[x - c] + 1);
        return dp[amount] > amount ? -1 : dp[amount];
    }
}
`,
    javascript: `var coinChange = function(coins, amount) {
    const dp = new Array(amount + 1).fill(amount + 1);
    dp[0] = 0;
    for (let x = 1; x <= amount; x++)
        for (const c of coins)
            if (c <= x) dp[x] = Math.min(dp[x], dp[x - c] + 1);
    return dp[amount] > amount ? -1 : dp[amount];
};
`,
  },

  'Longest Common Subsequence': {
    python: `class Solution:
    def longestCommonSubsequence(self, text1: str, text2: str) -> int:
        prev = [0] * (len(text2) + 1)
        for a in text1:
            cur = [0]
            for j, b in enumerate(text2):
                cur.append(prev[j] + 1 if a == b else max(prev[j + 1], cur[j]))
            prev = cur
        return prev[-1]
`,
    cpp: `class Solution {
public:
    int longestCommonSubsequence(string text1, string text2) {
        int n = text1.size(), m = text2.size();
        vector<vector<int>> dp(n + 1, vector<int>(m + 1, 0));
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = text1[i - 1] == text2[j - 1] ? dp[i - 1][j - 1] + 1 : max(dp[i - 1][j], dp[i][j - 1]);
        return dp[n][m];
    }
};
`,
    java: `class Solution {
    public int longestCommonSubsequence(String text1, String text2) {
        int n = text1.length(), m = text2.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++)
            for (int j = 1; j <= m; j++)
                dp[i][j] = text1.charAt(i - 1) == text2.charAt(j - 1) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        return dp[n][m];
    }
}
`,
    javascript: `var longestCommonSubsequence = function(text1, text2) {
    const n = text1.length, m = text2.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++)
        for (let j = 1; j <= m; j++)
            dp[i][j] = text1[i - 1] === text2[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[n][m];
};
`,
  },

  'Jump Game': {
    python: `class Solution:
    def canJump(self, nums: List[int]) -> bool:
        reach = 0
        for i, v in enumerate(nums):
            if i > reach:
                return False
            reach = max(reach, i + v)
        return True
`,
    cpp: `class Solution {
public:
    bool canJump(vector<int>& nums) {
        long long reach = 0;
        for (int i = 0; i < (int)nums.size(); i++) {
            if (i > reach) return false;
            reach = max(reach, (long long)i + nums[i]);
        }
        return true;
    }
};
`,
    java: `class Solution {
    public boolean canJump(int[] nums) {
        long reach = 0;
        for (int i = 0; i < nums.length; i++) {
            if (i > reach) return false;
            reach = Math.max(reach, (long) i + nums[i]);
        }
        return true;
    }
}
`,
    javascript: `var canJump = function(nums) {
    let reach = 0;
    for (let i = 0; i < nums.length; i++) {
        if (i > reach) return false;
        reach = Math.max(reach, i + nums[i]);
    }
    return true;
};
`,
  },

  'Merge Intervals': {
    python: `class Solution:
    def merge(self, intervals: List[List[int]]) -> List[List[int]]:
        out = []
        for start, end in sorted(intervals):
            if out and start <= out[-1][1]:
                out[-1][1] = max(out[-1][1], end)
            else:
                out.append([start, end])
        return out
`,
    cpp: `class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        sort(intervals.begin(), intervals.end());
        vector<vector<int>> out;
        for (auto& it : intervals) {
            if (!out.empty() && it[0] <= out.back()[1]) out.back()[1] = max(out.back()[1], it[1]);
            else out.push_back(it);
        }
        return out;
    }
};
`,
    java: `class Solution {
    public int[][] merge(int[][] intervals) {
        Arrays.sort(intervals, (a, b) -> a[0] != b[0] ? Integer.compare(a[0], b[0]) : Integer.compare(a[1], b[1]));
        List<int[]> out = new ArrayList<>();
        for (int[] it : intervals) {
            if (!out.isEmpty() && it[0] <= out.get(out.size() - 1)[1]) {
                out.get(out.size() - 1)[1] = Math.max(out.get(out.size() - 1)[1], it[1]);
            } else {
                out.add(new int[]{it[0], it[1]});
            }
        }
        return out.toArray(new int[0][]);
    }
}
`,
    javascript: `var merge = function(intervals) {
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [start, end] of intervals) {
        if (out.length && start <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], end);
        else out.push([start, end]);
    }
    return out;
};
`,
  },

  'Binary Search': {
    python: `class Solution:
    def search(self, nums: List[int], target: int) -> int:
        lo, hi = 0, len(nums) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if nums[mid] == target:
                return mid
            if nums[mid] < target:
                lo = mid + 1
            else:
                hi = mid - 1
        return -1
`,
    cpp: `class Solution {
public:
    int search(vector<int>& nums, int target) {
        int lo = 0, hi = (int)nums.size() - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) return mid;
            if (nums[mid] < target) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }
};
`,
    java: `class Solution {
    public int search(int[] nums, int target) {
        int lo = 0, hi = nums.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) return mid;
            if (nums[mid] < target) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }
}
`,
    javascript: `var search = function(nums, target) {
    let lo = 0, hi = nums.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (nums[mid] === target) return mid;
        if (nums[mid] < target) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
};
`,
  },

  'Search in Rotated Sorted Array': {
    python: `class Solution:
    def search(self, nums: List[int], target: int) -> int:
        lo, hi = 0, len(nums) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            if nums[mid] == target:
                return mid
            if nums[lo] <= nums[mid]:
                if nums[lo] <= target < nums[mid]:
                    hi = mid - 1
                else:
                    lo = mid + 1
            else:
                if nums[mid] < target <= nums[hi]:
                    lo = mid + 1
                else:
                    hi = mid - 1
        return -1
`,
    cpp: `class Solution {
public:
    int search(vector<int>& nums, int target) {
        int lo = 0, hi = (int)nums.size() - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) return mid;
            if (nums[lo] <= nums[mid]) {
                if (nums[lo] <= target && target < nums[mid]) hi = mid - 1; else lo = mid + 1;
            } else {
                if (nums[mid] < target && target <= nums[hi]) lo = mid + 1; else hi = mid - 1;
            }
        }
        return -1;
    }
};
`,
    java: `class Solution {
    public int search(int[] nums, int target) {
        int lo = 0, hi = nums.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) return mid;
            if (nums[lo] <= nums[mid]) {
                if (nums[lo] <= target && target < nums[mid]) hi = mid - 1; else lo = mid + 1;
            } else {
                if (nums[mid] < target && target <= nums[hi]) lo = mid + 1; else hi = mid - 1;
            }
        }
        return -1;
    }
}
`,
    javascript: `var search = function(nums, target) {
    let lo = 0, hi = nums.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (nums[mid] === target) return mid;
        if (nums[lo] <= nums[mid]) {
            if (nums[lo] <= target && target < nums[mid]) hi = mid - 1; else lo = mid + 1;
        } else {
            if (nums[mid] < target && target <= nums[hi]) lo = mid + 1; else hi = mid - 1;
        }
    }
    return -1;
};
`,
  },

  'Group Anagrams': {
    python: `class Solution:
    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:
        groups = defaultdict(list)
        for word in strs:
            groups[''.join(sorted(word))].append(word)
        return list(groups.values())
`,
    cpp: `class Solution {
public:
    vector<vector<string>> groupAnagrams(vector<string>& strs) {
        unordered_map<string, vector<string>> groups;
        for (auto& word : strs) { string key = word; sort(key.begin(), key.end()); groups[key].push_back(word); }
        vector<vector<string>> out;
        for (auto& entry : groups) out.push_back(entry.second);
        return out;
    }
};
`,
    java: `class Solution {
    public List<List<String>> groupAnagrams(String[] strs) {
        Map<String, List<String>> groups = new HashMap<>();
        for (String word : strs) {
            char[] key = word.toCharArray();
            Arrays.sort(key);
            groups.computeIfAbsent(new String(key), k -> new ArrayList<>()).add(word);
        }
        return new ArrayList<>(groups.values());
    }
}
`,
    javascript: `var groupAnagrams = function(strs) {
    const groups = new Map();
    for (const word of strs) {
        const key = word.split('').sort().join('');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(word);
    }
    return Array.from(groups.values());
};
`,
  },

  'Trapping Rain Water': {
    python: `class Solution:
    def trap(self, height: List[int]) -> int:
        lo, hi = 0, len(height) - 1
        left = right = water = 0
        while lo < hi:
            if height[lo] < height[hi]:
                left = max(left, height[lo])
                water += left - height[lo]
                lo += 1
            else:
                right = max(right, height[hi])
                water += right - height[hi]
                hi -= 1
        return water
`,
    cpp: `class Solution {
public:
    int trap(vector<int>& height) {
        int lo = 0, hi = (int)height.size() - 1, left = 0, right = 0, water = 0;
        while (lo < hi) {
            if (height[lo] < height[hi]) { left = max(left, height[lo]); water += left - height[lo]; lo++; }
            else { right = max(right, height[hi]); water += right - height[hi]; hi--; }
        }
        return water;
    }
};
`,
    java: `class Solution {
    public int trap(int[] height) {
        int lo = 0, hi = height.length - 1, left = 0, right = 0, water = 0;
        while (lo < hi) {
            if (height[lo] < height[hi]) { left = Math.max(left, height[lo]); water += left - height[lo]; lo++; }
            else { right = Math.max(right, height[hi]); water += right - height[hi]; hi--; }
        }
        return water;
    }
}
`,
    javascript: `var trap = function(height) {
    let lo = 0, hi = height.length - 1, left = 0, right = 0, water = 0;
    while (lo < hi) {
        if (height[lo] < height[hi]) { left = Math.max(left, height[lo]); water += left - height[lo]; lo++; }
        else { right = Math.max(right, height[hi]); water += right - height[hi]; hi--; }
    }
    return water;
};
`,
  },

  'N-Queens Count': {
    python: `class Solution:
    def totalNQueens(self, n: int) -> int:
        cols, diag, anti = set(), set(), set()
        def place(row):
            if row == n:
                return 1
            count = 0
            for c in range(n):
                if c in cols or row - c in diag or row + c in anti:
                    continue
                cols.add(c); diag.add(row - c); anti.add(row + c)
                count += place(row + 1)
                cols.discard(c); diag.discard(row - c); anti.discard(row + c)
            return count
        return place(0)
`,
    cpp: `class Solution {
    int place(int row, int n, vector<bool>& cols, vector<bool>& diag, vector<bool>& anti) {
        if (row == n) return 1;
        int count = 0;
        for (int c = 0; c < n; c++) {
            if (cols[c] || diag[row - c + n] || anti[row + c]) continue;
            cols[c] = diag[row - c + n] = anti[row + c] = true;
            count += place(row + 1, n, cols, diag, anti);
            cols[c] = diag[row - c + n] = anti[row + c] = false;
        }
        return count;
    }
public:
    int totalNQueens(int n) {
        vector<bool> cols(n, false), diag(2 * n + 1, false), anti(2 * n + 1, false);
        return place(0, n, cols, diag, anti);
    }
};
`,
    java: `class Solution {
    private int place(int row, int n, boolean[] cols, boolean[] diag, boolean[] anti) {
        if (row == n) return 1;
        int count = 0;
        for (int c = 0; c < n; c++) {
            if (cols[c] || diag[row - c + n] || anti[row + c]) continue;
            cols[c] = diag[row - c + n] = anti[row + c] = true;
            count += place(row + 1, n, cols, diag, anti);
            cols[c] = diag[row - c + n] = anti[row + c] = false;
        }
        return count;
    }
    public int totalNQueens(int n) {
        return place(0, n, new boolean[n], new boolean[2 * n + 1], new boolean[2 * n + 1]);
    }
}
`,
    javascript: `var totalNQueens = function(n) {
    const cols = new Set(), diag = new Set(), anti = new Set();
    const place = (row) => {
        if (row === n) return 1;
        let count = 0;
        for (let c = 0; c < n; c++) {
            if (cols.has(c) || diag.has(row - c) || anti.has(row + c)) continue;
            cols.add(c); diag.add(row - c); anti.add(row + c);
            count += place(row + 1);
            cols.delete(c); diag.delete(row - c); anti.delete(row + c);
        }
        return count;
    };
    return place(0);
};
`,
  },

  'Fibonacci Number': {
    python: `class Solution:
    def fib(self, n: int) -> int:
        a, b = 0, 1
        for _ in range(n):
            a, b = b, a + b
        return a
`,
    cpp: `class Solution {
public:
    long long fib(int n) {
        long long a = 0, b = 1;
        for (int i = 0; i < n; i++) { long long c = a + b; a = b; b = c; }
        return a;
    }
};
`,
    java: `class Solution {
    public long fib(int n) {
        long a = 0, b = 1;
        for (int i = 0; i < n; i++) { long c = a + b; a = b; b = c; }
        return a;
    }
}
`,
    javascript: `var fib = function(n) {
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) { const c = a + b; a = b; b = c; }
    return a;
};
`,
  },
};
