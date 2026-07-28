/**
 * Compact, real C and Java reference implementations for starter algorithms.
 *
 * Snippets favor readable core mechanics over command-line scaffolding.
 */

export const ALGORITHM_CODE_EXAMPLES = {
  "sample-algorithm-linear-search": {
    cCode: `int linear_search(const int values[], int length, int target) {
  for (int i = 0; i < length; i++) {
    if (values[i] == target) return i;
  }
  return -1;
}`,
    javaCode: `static int linearSearch(int[] values, int target) {
  for (int i = 0; i < values.length; i++) {
    if (values[i] == target) return i;
  }
  return -1;
}`,
  },
  "sample-algorithm-binary-search": {
    cCode: `int lower_bound(const int values[], int length, int target) {
  int low = 0, high = length;
  while (low < high) {
    int middle = low + (high - low) / 2;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}`,
    javaCode: `static int lowerBound(int[] values, int target) {
  int low = 0, high = values.length;
  while (low < high) {
    int middle = low + (high - low) / 2;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}`,
  },
  "sample-algorithm-bubble-sort": {
    cCode: `void bubble_sort(int values[], int length) {
  for (int end = length - 1; end > 0; end--) {
    int swapped = 0;
    for (int i = 0; i < end; i++) {
      if (values[i] > values[i + 1]) {
        int temp = values[i];
        values[i] = values[i + 1];
        values[i + 1] = temp;
        swapped = 1;
      }
    }
    if (!swapped) break;
  }
}`,
    javaCode: `static void bubbleSort(int[] values) {
  for (int end = values.length - 1; end > 0; end--) {
    boolean swapped = false;
    for (int i = 0; i < end; i++) {
      if (values[i] > values[i + 1]) {
        int temp = values[i];
        values[i] = values[i + 1];
        values[i + 1] = temp;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
}`,
  },
  "sample-algorithm-selection-sort": {
    cCode: `void selection_sort(int values[], int length) {
  for (int start = 0; start < length - 1; start++) {
    int minimum = start;
    for (int i = start + 1; i < length; i++) {
      if (values[i] < values[minimum]) minimum = i;
    }
    int temp = values[start];
    values[start] = values[minimum];
    values[minimum] = temp;
  }
}`,
    javaCode: `static void selectionSort(int[] values) {
  for (int start = 0; start < values.length - 1; start++) {
    int minimum = start;
    for (int i = start + 1; i < values.length; i++) {
      if (values[i] < values[minimum]) minimum = i;
    }
    int temp = values[start];
    values[start] = values[minimum];
    values[minimum] = temp;
  }
}`,
  },
  "sample-algorithm-insertion-sort": {
    cCode: `void insertion_sort(int values[], int length) {
  for (int i = 1; i < length; i++) {
    int value = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
}`,
    javaCode: `static void insertionSort(int[] values) {
  for (int i = 1; i < values.length; i++) {
    int value = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j--];
    }
    values[j + 1] = value;
  }
}`,
  },
  "sample-algorithm-merge-sort": {
    cCode: `void merge_sort(int values[], int temp[], int low, int high) {
  if (high - low <= 1) return;
  int middle = low + (high - low) / 2;
  merge_sort(values, temp, low, middle);
  merge_sort(values, temp, middle, high);
  int left = low, right = middle, out = low;
  while (left < middle && right < high) {
    temp[out++] = values[left] <= values[right]
      ? values[left++] : values[right++];
  }
  while (left < middle) temp[out++] = values[left++];
  while (right < high) temp[out++] = values[right++];
  for (int i = low; i < high; i++) values[i] = temp[i];
}`,
    javaCode: `static void mergeSort(int[] values, int[] temp, int low, int high) {
  if (high - low <= 1) return;
  int middle = low + (high - low) / 2;
  mergeSort(values, temp, low, middle);
  mergeSort(values, temp, middle, high);
  int left = low, right = middle, out = low;
  while (left < middle && right < high) {
    temp[out++] = values[left] <= values[right]
      ? values[left++] : values[right++];
  }
  while (left < middle) temp[out++] = values[left++];
  while (right < high) temp[out++] = values[right++];
  System.arraycopy(temp, low, values, low, high - low);
}`,
  },
  "sample-algorithm-quicksort": {
    cCode: `void quicksort(int values[], int low, int high) {
  if (low >= high) return;
  int pivot = values[high], boundary = low;
  for (int i = low; i < high; i++) {
    if (values[i] <= pivot) {
      int temp = values[i];
      values[i] = values[boundary];
      values[boundary++] = temp;
    }
  }
  values[high] = values[boundary];
  values[boundary] = pivot;
  quicksort(values, low, boundary - 1);
  quicksort(values, boundary + 1, high);
}`,
    javaCode: `static void quicksort(int[] values, int low, int high) {
  if (low >= high) return;
  int pivot = values[high], boundary = low;
  for (int i = low; i < high; i++) {
    if (values[i] <= pivot) {
      int temp = values[i];
      values[i] = values[boundary];
      values[boundary++] = temp;
    }
  }
  values[high] = values[boundary];
  values[boundary] = pivot;
  quicksort(values, low, boundary - 1);
  quicksort(values, boundary + 1, high);
}`,
  },
  "sample-algorithm-heap-sort": {
    cCode: `void sift_down(int values[], int root, int size) {
  while (root * 2 + 1 < size) {
    int child = root * 2 + 1;
    if (child + 1 < size && values[child + 1] > values[child]) child++;
    if (values[root] >= values[child]) return;
    int temp = values[root];
    values[root] = values[child];
    values[child] = temp;
    root = child;
  }
}

void heap_sort(int values[], int length) {
  for (int i = length / 2 - 1; i >= 0; i--) sift_down(values, i, length);
  for (int end = length - 1; end > 0; end--) {
    int temp = values[0]; values[0] = values[end]; values[end] = temp;
    sift_down(values, 0, end);
  }
}`,
    javaCode: `static void siftDown(int[] values, int root, int size) {
  while (root * 2 + 1 < size) {
    int child = root * 2 + 1;
    if (child + 1 < size && values[child + 1] > values[child]) child++;
    if (values[root] >= values[child]) return;
    int temp = values[root]; values[root] = values[child]; values[child] = temp;
    root = child;
  }
}

static void heapSort(int[] values) {
  for (int i = values.length / 2 - 1; i >= 0; i--) siftDown(values, i, values.length);
  for (int end = values.length - 1; end > 0; end--) {
    int temp = values[0]; values[0] = values[end]; values[end] = temp;
    siftDown(values, 0, end);
  }
}`,
  },
  "sample-algorithm-breadth-first-search": {
    cCode: `void bfs(int graph[][100], int vertex_count, int start) {
  int visited[100] = {0}, queue[100], front = 0, back = 0;
  visited[start] = 1;
  queue[back++] = start;
  while (front < back) {
    int vertex = queue[front++];
    printf("%d ", vertex);
    for (int next = 0; next < vertex_count; next++) {
      if (graph[vertex][next] && !visited[next]) {
        visited[next] = 1;
        queue[back++] = next;
      }
    }
  }
}`,
    javaCode: `static void bfs(List<List<Integer>> graph, int start) {
  boolean[] visited = new boolean[graph.size()];
  Queue<Integer> queue = new ArrayDeque<>();
  visited[start] = true;
  queue.add(start);
  while (!queue.isEmpty()) {
    int vertex = queue.remove();
    System.out.println(vertex);
    for (int next : graph.get(vertex)) {
      if (!visited[next]) {
        visited[next] = true;
        queue.add(next);
      }
    }
  }
}`,
  },
  "sample-algorithm-depth-first-search": {
    cCode: `void dfs(int graph[][100], int vertex_count, int vertex, int visited[]) {
  visited[vertex] = 1;
  printf("%d ", vertex);
  for (int next = 0; next < vertex_count; next++) {
    if (graph[vertex][next] && !visited[next]) {
      dfs(graph, vertex_count, next, visited);
    }
  }
}`,
    javaCode: `static void dfs(List<List<Integer>> graph, int vertex, boolean[] visited) {
  visited[vertex] = true;
  System.out.println(vertex);
  for (int next : graph.get(vertex)) {
    if (!visited[next]) dfs(graph, next, visited);
  }
}`,
  },
  "sample-algorithm-tree-traversals": {
    cCode: `typedef struct Node {
  int value;
  struct Node *left;
  struct Node *right;
} Node;

void inorder(const Node *node) {
  if (node == NULL) return;
  inorder(node->left);
  printf("%d ", node->value);
  inorder(node->right);
}`,
    javaCode: `static final class Node {
  int value;
  Node left;
  Node right;
}

static void inorder(Node node) {
  if (node == null) return;
  inorder(node.left);
  System.out.println(node.value);
  inorder(node.right);
}`,
  },
  "sample-algorithm-dijkstra": {
    cCode: `void dijkstra(int graph[][100], int count, int start, int distance[]) {
  int used[100] = {0};
  for (int i = 0; i < count; i++) distance[i] = INT_MAX;
  distance[start] = 0;
  for (int step = 0; step < count; step++) {
    int vertex = -1;
    for (int i = 0; i < count; i++) {
      if (!used[i] && (vertex < 0 || distance[i] < distance[vertex])) vertex = i;
    }
    if (vertex < 0 || distance[vertex] == INT_MAX) break;
    used[vertex] = 1;
    for (int next = 0; next < count; next++) {
      int weight = graph[vertex][next];
      if (weight > 0 && distance[vertex] + weight < distance[next]) {
        distance[next] = distance[vertex] + weight;
      }
    }
  }
}`,
    javaCode: `record Edge(int to, int weight) {}

static int[] dijkstra(List<List<Edge>> graph, int start) {
  int[] distance = new int[graph.size()];
  Arrays.fill(distance, Integer.MAX_VALUE);
  PriorityQueue<Edge> queue = new PriorityQueue<>(Comparator.comparingInt(e -> e.weight));
  distance[start] = 0;
  queue.add(new Edge(start, 0));
  while (!queue.isEmpty()) {
    Edge current = queue.remove();
    if (current.weight != distance[current.to]) continue;
    for (Edge edge : graph.get(current.to)) {
      int candidate = current.weight + edge.weight;
      if (candidate < distance[edge.to]) {
        distance[edge.to] = candidate;
        queue.add(new Edge(edge.to, candidate));
      }
    }
  }
  return distance;
}`,
  },
  "sample-algorithm-topological-sort": {
    cCode: `int topological_sort(int graph[][100], int count, int output[]) {
  int indegree[100] = {0}, queue[100], front = 0, back = 0, written = 0;
  for (int from = 0; from < count; from++)
    for (int to = 0; to < count; to++)
      if (graph[from][to]) indegree[to]++;
  for (int i = 0; i < count; i++) if (indegree[i] == 0) queue[back++] = i;
  while (front < back) {
    int vertex = queue[front++];
    output[written++] = vertex;
    for (int next = 0; next < count; next++)
      if (graph[vertex][next] && --indegree[next] == 0) queue[back++] = next;
  }
  return written == count;
}`,
    javaCode: `static List<Integer> topologicalSort(List<List<Integer>> graph) {
  int[] indegree = new int[graph.size()];
  for (List<Integer> edges : graph) for (int to : edges) indegree[to]++;
  Queue<Integer> queue = new ArrayDeque<>();
  for (int i = 0; i < indegree.length; i++) if (indegree[i] == 0) queue.add(i);
  List<Integer> order = new ArrayList<>();
  while (!queue.isEmpty()) {
    int vertex = queue.remove();
    order.add(vertex);
    for (int next : graph.get(vertex)) if (--indegree[next] == 0) queue.add(next);
  }
  if (order.size() != graph.size()) throw new IllegalArgumentException("Cycle");
  return order;
}`,
  },
  "sample-algorithm-two-pointers": {
    cCode: `int has_pair_sum(const int values[], int length, int target) {
  int left = 0, right = length - 1;
  while (left < right) {
    int sum = values[left] + values[right];
    if (sum == target) return 1;
    if (sum < target) left++;
    else right--;
  }
  return 0;
}`,
    javaCode: `static boolean hasPairSum(int[] values, int target) {
  int left = 0, right = values.length - 1;
  while (left < right) {
    int sum = values[left] + values[right];
    if (sum == target) return true;
    if (sum < target) left++;
    else right--;
  }
  return false;
}`,
  },
  "sample-algorithm-sliding-window": {
    cCode: `int longest_unique_substring(const unsigned char text[]) {
  int last[256], left = 0, best = 0;
  for (int i = 0; i < 256; i++) last[i] = -1;
  for (int right = 0; text[right] != '\\0'; right++) {
    if (last[text[right]] >= left) left = last[text[right]] + 1;
    last[text[right]] = right;
    int length = right - left + 1;
    if (length > best) best = length;
  }
  return best;
}`,
    javaCode: `static int longestUniqueSubstring(String text) {
  Map<Character, Integer> last = new HashMap<>();
  int left = 0, best = 0;
  for (int right = 0; right < text.length(); right++) {
    char value = text.charAt(right);
    if (last.getOrDefault(value, -1) >= left) left = last.get(value) + 1;
    last.put(value, right);
    best = Math.max(best, right - left + 1);
  }
  return best;
}`,
  },
  "sample-algorithm-prefix-sums": {
    cCode: `void build_prefix_sums(const int values[], int length, long prefix[]) {
  prefix[0] = 0;
  for (int i = 0; i < length; i++) {
    prefix[i + 1] = prefix[i] + values[i];
  }
}

long range_sum(const long prefix[], int left, int right) {
  return prefix[right] - prefix[left];
}`,
    javaCode: `static long[] buildPrefixSums(int[] values) {
  long[] prefix = new long[values.length + 1];
  for (int i = 0; i < values.length; i++) {
    prefix[i + 1] = prefix[i] + values[i];
  }
  return prefix;
}

static long rangeSum(long[] prefix, int left, int right) {
  return prefix[right] - prefix[left];
}`,
  },
  "sample-algorithm-euclidean-gcd": {
    cCode: `int gcd(int a, int b) {
  while (b != 0) {
    int remainder = a % b;
    a = b;
    b = remainder;
  }
  return a < 0 ? -a : a;
}`,
    javaCode: `static int gcd(int a, int b) {
  while (b != 0) {
    int remainder = a % b;
    a = b;
    b = remainder;
  }
  return Math.abs(a);
}`,
  },
  "sample-algorithm-a-star": {
    cCode: `void a_star(int graph[][100], int heuristic[], int count, int start, int goal) {
  int cost[100], parent[100], open[100] = {0}, closed[100] = {0};
  for (int i = 0; i < count; i++) cost[i] = INT_MAX, parent[i] = -1;
  cost[start] = 0; open[start] = 1;
  while (1) {
    int current = -1;
    for (int i = 0; i < count; i++)
      if (open[i] && (current < 0 || cost[i] + heuristic[i] < cost[current] + heuristic[current]))
        current = i;
    if (current < 0 || current == goal) break;
    open[current] = 0; closed[current] = 1;
    for (int next = 0; next < count; next++) {
      if (graph[current][next] <= 0 || closed[next]) continue;
      int candidate = cost[current] + graph[current][next];
      if (candidate < cost[next]) {
        cost[next] = candidate; parent[next] = current; open[next] = 1;
      }
    }
  }
}`,
    javaCode: `record Edge(int to, int weight) {}

static int[] aStar(List<List<Edge>> graph, int[] heuristic, int start, int goal) {
  int[] cost = new int[graph.size()], parent = new int[graph.size()];
  Arrays.fill(cost, Integer.MAX_VALUE);
  Arrays.fill(parent, -1);
  PriorityQueue<Edge> open = new PriorityQueue<>(Comparator.comparingInt(e -> e.weight));
  cost[start] = 0;
  open.add(new Edge(start, heuristic[start]));
  while (!open.isEmpty()) {
    int current = open.remove().to;
    if (current == goal) break;
    for (Edge edge : graph.get(current)) {
      int candidate = cost[current] + edge.weight;
      if (candidate < cost[edge.to]) {
        cost[edge.to] = candidate;
        parent[edge.to] = current;
        open.add(new Edge(edge.to, candidate + heuristic[edge.to]));
      }
    }
  }
  return parent;
}`,
  },
  "sample-algorithm-union-find": {
    cCode: `int find(int parent[], int value) {
  if (parent[value] != value) parent[value] = find(parent, parent[value]);
  return parent[value];
}

void unite(int parent[], int rank[], int left, int right) {
  int root_left = find(parent, left), root_right = find(parent, right);
  if (root_left == root_right) return;
  if (rank[root_left] < rank[root_right]) parent[root_left] = root_right;
  else if (rank[root_left] > rank[root_right]) parent[root_right] = root_left;
  else { parent[root_right] = root_left; rank[root_left]++; }
}`,
    javaCode: `static final class UnionFind {
  private final int[] parent;
  private final int[] rank;

  UnionFind(int size) {
    parent = new int[size]; rank = new int[size];
    for (int i = 0; i < size; i++) parent[i] = i;
  }

  int find(int value) {
    if (parent[value] != value) parent[value] = find(parent[value]);
    return parent[value];
  }

  void union(int left, int right) {
    int a = find(left), b = find(right);
    if (a == b) return;
    if (rank[a] < rank[b]) parent[a] = b;
    else if (rank[a] > rank[b]) parent[b] = a;
    else { parent[b] = a; rank[a]++; }
  }
}`,
  },
  "sample-algorithm-kmp": {
    cCode: `int kmp_search(const char *text, const char *pattern) {
  int m = strlen(pattern), lps[1000], length = 0;
  lps[0] = 0;
  for (int i = 1; i < m;) {
    if (pattern[i] == pattern[length]) lps[i++] = ++length;
    else if (length) length = lps[length - 1];
    else lps[i++] = 0;
  }
  for (int i = 0, j = 0; text[i] != '\\0';) {
    if (text[i] == pattern[j]) { i++; j++; }
    if (j == m) return i - j;
    if (text[i] != pattern[j]) j ? (j = lps[j - 1]) : i++;
  }
  return -1;
}`,
    javaCode: `static int kmpSearch(String text, String pattern) {
  int[] lps = new int[pattern.length()];
  for (int i = 1, length = 0; i < pattern.length();) {
    if (pattern.charAt(i) == pattern.charAt(length)) lps[i++] = ++length;
    else if (length > 0) length = lps[length - 1];
    else lps[i++] = 0;
  }
  for (int i = 0, j = 0; i < text.length();) {
    if (text.charAt(i) == pattern.charAt(j)) { i++; j++; }
    if (j == pattern.length()) return i - j;
    if (i < text.length() && text.charAt(i) != pattern.charAt(j)) {
      if (j > 0) j = lps[j - 1]; else i++;
    }
  }
  return -1;
}`,
  },
  "sample-algorithm-longest-common-subsequence": {
    cCode: `int lcs_length(const char *left, const char *right) {
  int n = strlen(left), m = strlen(right);
  int table[n + 1][m + 1];
  for (int i = 0; i <= n; i++) table[i][0] = 0;
  for (int j = 0; j <= m; j++) table[0][j] = 0;
  for (int i = 1; i <= n; i++)
    for (int j = 1; j <= m; j++)
      table[i][j] = left[i - 1] == right[j - 1]
        ? table[i - 1][j - 1] + 1
        : (table[i - 1][j] > table[i][j - 1] ? table[i - 1][j] : table[i][j - 1]);
  return table[n][m];
}`,
    javaCode: `static int lcsLength(String left, String right) {
  int[][] table = new int[left.length() + 1][right.length() + 1];
  for (int i = 1; i <= left.length(); i++) {
    for (int j = 1; j <= right.length(); j++) {
      table[i][j] = left.charAt(i - 1) == right.charAt(j - 1)
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table[left.length()][right.length()];
}`,
  },
  "sample-algorithm-bellman-ford": {
    cCode: `typedef struct { int from, to, weight; } Edge;

int bellman_ford(const Edge edges[], int edge_count, int vertex_count,
                 int start, int distance[]) {
  for (int i = 0; i < vertex_count; i++) distance[i] = INT_MAX;
  distance[start] = 0;
  for (int pass = 1; pass < vertex_count; pass++)
    for (int i = 0; i < edge_count; i++)
      if (distance[edges[i].from] != INT_MAX &&
          distance[edges[i].from] + edges[i].weight < distance[edges[i].to])
        distance[edges[i].to] = distance[edges[i].from] + edges[i].weight;
  for (int i = 0; i < edge_count; i++)
    if (distance[edges[i].from] != INT_MAX &&
        distance[edges[i].from] + edges[i].weight < distance[edges[i].to])
      return 0;
  return 1;
}`,
    javaCode: `record Edge(int from, int to, int weight) {}

static int[] bellmanFord(List<Edge> edges, int vertexCount, int start) {
  int[] distance = new int[vertexCount];
  Arrays.fill(distance, Integer.MAX_VALUE);
  distance[start] = 0;
  for (int pass = 1; pass < vertexCount; pass++) {
    for (Edge edge : edges) {
      if (distance[edge.from()] != Integer.MAX_VALUE &&
          distance[edge.from()] + edge.weight() < distance[edge.to()]) {
        distance[edge.to()] = distance[edge.from()] + edge.weight();
      }
    }
  }
  for (Edge edge : edges) {
    if (distance[edge.from()] != Integer.MAX_VALUE &&
        distance[edge.from()] + edge.weight() < distance[edge.to()]) {
      throw new IllegalArgumentException("Negative cycle");
    }
  }
  return distance;
}`,
  },
};
