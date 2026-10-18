package main

import (
	"fmt"

	sh "example.com/goapp/internal/shapes"
)

func main() {
	r := sh.NewRect(1, 2)
	fmt.Println(sh.Total([]sh.Shape{r}))
	_ = sh.Rect{W: 1}
}
