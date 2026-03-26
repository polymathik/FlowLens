#include <stdio.h>
#include "myheader.h"

struct Point {
    int x;
    int y;
};

int add(int a, int b) {
    return a + b;
}

int main() {
    struct Point p;
    p.x = 10;
    int result = add(1, 2);
    printf("%d\n", result);
    return 0;
}
