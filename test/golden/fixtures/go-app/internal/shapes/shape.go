package shapes

type Shape interface {
	Area() float64
}

type Rect struct {
	W, H float64
}

func (r Rect) Area() float64 {
	return r.W * r.H
}

func NewRect(w, h float64) Rect {
	return Rect{W: w, H: h}
}

func helper() float64 {
	return 0
}
